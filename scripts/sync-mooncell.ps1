[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\data\mooncell-snapshot.js")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-WikiText {
    param([Parameter(Mandatory)][string]$Title)

    $encodedTitle = [System.Uri]::EscapeDataString($Title)
    $uri = "https://fgo.wiki/api.php?action=query&format=json&formatversion=2&titles=$encodedTitle&prop=revisions&rvprop=content&rvslots=main"
    $response = Invoke-RestMethod -Uri $uri -TimeoutSec 60
    $page = @($response.query.pages)[0]
    $content = $page.revisions[0].slots.main.content
    if ([string]::IsNullOrWhiteSpace($content)) {
        throw "Mooncell 未返回页面内容：$Title"
    }
    return [string]$content
}

function Get-WikiPages {
    param([Parameter(Mandatory)][string[]]$Titles)

    $joinedTitles = [string]::Join("|", $Titles)
    $encodedTitles = [System.Uri]::EscapeDataString($joinedTitles)
    $uri = "https://fgo.wiki/api.php?action=query&format=json&formatversion=2&redirects=1&titles=$encodedTitles&prop=revisions&rvprop=content&rvslots=main"
    return Invoke-RestMethod -Uri $uri -TimeoutSec 90
}

function Test-CompleteBondPoints {
    param([AllowNull()]$Points)

    $values = @($Points)
    return $values.Count -eq 10 -and @($values | Where-Object { [int64]$_ -le 0 }).Count -eq 0
}

function Get-AtlasBondPoints {
    param([Parameter(Mandatory)][string]$CollectionNo)

    $uri = "https://api.atlasacademy.io/nice/JP/servant/$([System.Uri]::EscapeDataString($CollectionNo))"
    $response = Invoke-RestMethod -Uri $uri -TimeoutSec 60
    $cumulative = @($response.bondGrowth | Select-Object -First 10)
    if ($cumulative.Count -ne 10) { return @() }

    $points = [System.Collections.Generic.List[int64]]::new()
    [int64]$previous = 0
    foreach ($value in $cumulative) {
        [int64]$current = 0
        if (-not [int64]::TryParse([string]$value, [ref]$current) -or $current -le $previous) { return @() }
        [void]$points.Add($current - $previous)
        $previous = $current
    }
    return @($points)
}

function Get-RecordValue {
    param(
        [Parameter(Mandatory)]$Record,
        [Parameter(Mandatory)][string]$Name
    )

    $property = $Record.PSObject.Properties[$Name]
    if ($null -eq $property) { return "" }
    return [string]$property.Value
}

function Get-Integer {
    param(
        [AllowNull()]$Value,
        [int]$Fallback = 0
    )

    $parsed = 0
    if ([int]::TryParse([string]$Value, [ref]$parsed)) { return $parsed }
    return $Fallback
}

function Convert-ImageUrl {
    param([string]$Value)
    if ($Value.StartsWith("//")) { return "https:$Value" }
    return $Value
}

function Convert-CleanWikiText {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    $clean = $Value -replace '<br\s*/?>', ' '
    $clean = $clean -replace '<[^>]+>', ''
    $clean = $clean -replace '\[\[([^\]|]+)\|([^\]]+)\]\]', '$2'
    $clean = $clean -replace '\[\[([^\]]+)\]\]', '$1'
    $clean = $clean -replace '{{[^{}]*}}', ''
    return ($clean -replace '\s+', ' ').Trim()
}

function Convert-GrandBattleName {
    param([string]$Value)

    $name = [string]$Value
    $template = '\{\{[^{}|]+\|(?:[^{}|]*\|)*([^{}|]+)\}\}'
    $previous = ""
    while ($name -ne $previous) {
        $previous = $name
        $name = [regex]::Replace($name, $template, '$1')
    }
    $name = Convert-CleanWikiText $name
    $name = $name -replace '冠位解放戦', '冠位解放战'
    $name = $name -replace '冠位認定戦', '冠位认定战'
    $name = $name -replace '冠位研鑽戦', '冠位钻研战'
    foreach ($entry in ([ordered]@{
        'セイバー' = 'Saber'
        'アーチャー' = 'Archer'
        'ランサー' = 'Lancer'
        'ライダー' = 'Rider'
        'キャスター' = 'Caster'
        'アサシン' = 'Assassin'
        'バーサーカー' = 'Berserker'
        'エクストラ' = 'Extra'
    }).GetEnumerator()) {
        $name = $name -replace [regex]::Escape($entry.Key), $entry.Value
    }
    return $name
}

function Convert-NormalizedTitle {
    param([string]$Title)
    return ($Title -replace '_', ' ').Trim()
}

function Parse-KeyValueRecords {
    param([Parameter(Mandatory)][string]$Text)

    $records = @()
    foreach ($block in [regex]::Split($Text.Trim(), "\r?\n\s*\r?\n")) {
        $record = [ordered]@{}
        foreach ($line in ($block -split "\r?\n")) {
            $index = $line.IndexOf('=')
            if ($index -gt 0) {
                $record[$line.Substring(0, $index).Trim()] = $line.Substring($index + 1).Trim()
            }
        }
        if ($record.Contains('id')) { $records += [pscustomobject]$record }
    }
    return $records
}

function Parse-CoreRecords {
    param([Parameter(Mandatory)][string]$Text)

    $lines = $Text.Trim() -split "\r?\n"
    $headers = $lines[0].Split(',')
    $records = @()
    foreach ($line in $lines[1..($lines.Count - 1)]) {
        $columns = $line.Split(',')
        $record = [ordered]@{}
        for ($index = 0; $index -lt $headers.Count; $index++) {
            $record[$headers[$index]] = if ($index -lt $columns.Count) { $columns[$index] } else { "" }
        }
        $records += [pscustomobject]$record
    }
    return $records
}

function Get-TemplateFields {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$TemplateName
    )

    $match = [regex]::Match($Text, "\{\{$TemplateName(?s:.*?)\r?\n\}\}")
    $fields = @{}
    if (-not $match.Success) { return $fields }
    foreach ($line in ($match.Value -split "\r?\n")) {
        $field = [regex]::Match($line, '^\|([^=|]+)=(.*)$')
        if ($field.Success) {
            $fields[$field.Groups[1].Value.Trim()] = Convert-CleanWikiText $field.Groups[2].Value
        }
    }
    return $fields
}

function Get-Field {
    param($Fields, [string]$Name, [string]$Fallback = "")
    if ($Fields.ContainsKey($Name)) { return [string]$Fields[$Name] }
    return $Fallback
}

function Parse-ServantProfile {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)]$Fallback
    )

    $basic = Get-TemplateFields -Text $Text -TemplateName "基础数值"
    $bondMatch = [regex]::Match($Text, '\{\{牵绊点数\s*\|([^\r\n}]+)')
    $points = @()
    if ($bondMatch.Success) {
        $points = @($bondMatch.Groups[1].Value.Split('|') | Select-Object -First 10 | ForEach-Object {
            $digits = $_ -replace '\D', ''
            if ($digits) { [int64]$digits } else { 0 }
        })
    }
    $traits = @()
    foreach ($key in $basic.Keys) {
        if ($key -match '^特性\d+$' -and $basic[$key]) { $traits += $basic[$key] }
    }
    $attributes = @()
    foreach ($key in @("属性1", "属性2")) {
        if ($basic.ContainsKey($key) -and $basic[$key]) { $attributes += $basic[$key] }
    }
    $bondSource = if (Test-CompleteBondPoints $points) { "Mooncell" } else { "" }
    return [ordered]@{
        id = $Fallback.id
        name = (Get-Field $basic "中文名" $Fallback.name)
        className = (Get-Field $basic "职阶" $Fallback.className)
        star = Get-Integer (Get-Field $basic "稀有度" $Fallback.star) $Fallback.star
        cost = Get-Integer (Get-Field $basic "COST" $Fallback.cost) $Fallback.cost
        attributes = @($attributes)
        subAttribute = (Get-Field $basic "副属性" $Fallback.subAttribute)
        gender = (Get-Field $basic "性别")
        traits = @($traits)
        nickname = (Get-Field $basic "昵称")
        bondPoints = @($points)
        bondSource = $bondSource
    }
}

function Get-GrandAllowedClasses {
    param(
        [Parameter(Mandatory)][string]$ClassName,
        [string]$Rule = ""
    )

    if ($ClassName -ne "Extra") { return @($ClassName) }
    if ($Rule -match '(?i)extra\s*Ⅰ') { return @("Ruler", "Avenger", "MoonCancer", "Shielder") }
    if ($Rule -match '(?i)extra\s*Ⅱ') { return @("Alterego", "Foreigner", "Pretender", "Beast") }
    return @("Ruler", "Avenger", "MoonCancer", "Shielder", "Alterego", "Foreigner", "Pretender", "Beast")
}

function Parse-GrandBattles {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$ClassName
    )

    $quests = @()
    $heading = ""
    $section = ""
    $inside = $false
    $fields = @{}
    foreach ($line in ($Text -split "\r?\n")) {
        $levelTwo = [regex]::Match($line, '^==([^=]+)==$')
        $levelThree = [regex]::Match($line, '^===([^=]+)===$')
        if ($levelTwo.Success) { $section = Convert-CleanWikiText $levelTwo.Groups[1].Value }
        if ($levelThree.Success) { $heading = Convert-CleanWikiText $levelThree.Groups[1].Value }
        if ($line.Trim() -eq '{{关卡配置') {
            $inside = $true
            $fields = @{}
            continue
        }
        if ($inside -and $line.Trim() -eq '}}') {
            $baseBond = 0
            if ($fields.ContainsKey('牵绊')) { [void][int]::TryParse(($fields['牵绊'] -replace '\D', ''), [ref]$baseBond) }
            if ($baseBond -gt 0) {
                $nameCn = if ($fields.ContainsKey('名称cn')) { [string]$fields['名称cn'] } else { "" }
                $nameJp = if ($fields.ContainsKey('名称jp')) { [string]$fields['名称jp'] } else { "" }
                $name = Convert-GrandBattleName $nameCn
                if (-not $name) { $name = Convert-GrandBattleName $heading }
                if (-not $name) { $name = Convert-GrandBattleName $nameJp }
                if (-not $name) { $name = "冠位戴冠战：$ClassName（$($quests.Count + 1)）" }
                $rule = if ($fields.ContainsKey('一杂项内容')) { $fields['一杂项内容'] } else { "" }
                $id = "$ClassName`:$name`:$baseBond"
                if (@($quests | Where-Object { $_.id -eq $id }).Count -gt 0) {
                    $name = "$name（$($quests.Count + 1)）"
                    $id = "$ClassName`:$name`:$baseBond"
                }
                $quests += [ordered]@{
                    id = $id
                    className = $ClassName
                    name = $name
                    baseBond = $baseBond
                    allowedClasses = @(Get-GrandAllowedClasses -ClassName $ClassName -Rule $rule)
                    section = $section
                    sourceUrl = "https://fgo.wiki/w/$([System.Uri]::EscapeDataString("冠位戴冠战：$ClassName/关卡配置"))"
                }
            }
            $inside = $false
            continue
        }
        if ($inside) {
            $field = [regex]::Match($line, '^\|([^=]+)=(.*)$')
            if ($field.Success) { $fields[$field.Groups[1].Value.Trim()] = $field.Groups[2].Value.Trim() }
        }
    }
    return $quests
}

Write-Output "正在读取 Mooncell 图鉴索引..."
$servantIndexText = Get-WikiText "英灵图鉴/数据"
$servantCoreText = Get-WikiText "微件:ServantsList/core"
$craftIndexText = Get-WikiText "礼装图鉴/数据"
$craftCoreText = Get-WikiText "微件:CraftsList/core"

$coreById = @{}
foreach ($record in (Parse-CoreRecords $servantCoreText)) { $coreById[(Get-RecordValue $record 'id')] = $record }
$craftCoreById = @{}
foreach ($record in (Parse-CoreRecords $craftCoreText)) { $craftCoreById[(Get-RecordValue $record 'id')] = $record }

$servants = @()
foreach ($record in (Parse-KeyValueRecords $servantIndexText)) {
    $id = Get-RecordValue $record 'id'
    $core = if ($coreById.ContainsKey($id)) { $coreById[$id] } else { $null }
    $title = Get-RecordValue $record 'name_link'
    if (-not $title) { $title = Get-RecordValue $record 'name_cn' }
    if (-not $title) { continue }
    $aliases = @(
        Get-RecordValue $record 'name_cn'
        Get-RecordValue $record 'name_jp'
        Get-RecordValue $record 'name_en'
        $title
        ((Get-RecordValue $record 'name_other') -split '[&＆]')
    ) | Where-Object { $_ } | Select-Object -Unique
    $servants += [ordered]@{
        id = $id
        name = (Get-RecordValue $record 'name_cn')
        title = $title
        aliases = @($aliases)
        className = (Get-RecordValue $core 'class_link')
        star = Get-Integer (Get-RecordValue $core 'star')
        cost = Get-Integer (Get-RecordValue $core 'cost')
        avatar = Convert-ImageUrl (Get-RecordValue $core 'avatar')
        subAttribute = (Get-RecordValue $core 'faction')
        sourceUrl = "https://fgo.wiki/w/$([System.Uri]::EscapeDataString(($title -replace ' ', '_')))"
    }
}

$servants = @($servants | Sort-Object { [int]$_.id } -Descending)
$idByTitle = @{}
foreach ($servant in $servants) { $idByTitle[(Convert-NormalizedTitle $servant.title)] = [string]$servant.id }

Write-Output "正在读取 $($servants.Count) 骑从者的羁绊阈值与属性..."
$profiles = [ordered]@{}
$chunkSize = 20
for ($offset = 0; $offset -lt $servants.Count; $offset += $chunkSize) {
    $end = [Math]::Min($offset + $chunkSize - 1, $servants.Count - 1)
    $chunk = @($servants[$offset..$end])
    $response = Get-WikiPages -Titles @($chunk | ForEach-Object { $_.title })
    $resolvedIds = @{}
    foreach ($servant in $chunk) { $resolvedIds[(Convert-NormalizedTitle $servant.title)] = [string]$servant.id }
    $redirectProperty = $response.query.PSObject.Properties['redirects']
    if ($null -ne $redirectProperty) {
        foreach ($redirect in @($redirectProperty.Value)) {
            $from = Convert-NormalizedTitle $redirect.from
            $to = Convert-NormalizedTitle $redirect.to
            if ($resolvedIds.ContainsKey($from)) { $resolvedIds[$to] = $resolvedIds[$from] }
        }
    }
    foreach ($page in @($response.query.pages)) {
        $pageTitle = Convert-NormalizedTitle $page.title
        if (-not $resolvedIds.ContainsKey($pageTitle)) { continue }
        $content = [string]$page.revisions[0].slots.main.content
        if (-not $content) { continue }
        $id = $resolvedIds[$pageTitle]
        $fallback = $servants | Where-Object { [string]$_.id -eq $id } | Select-Object -First 1
        $profiles[$id] = Parse-ServantProfile -Text $content -Fallback $fallback
    }
    Write-Output "  已处理 $($end + 1) / $($servants.Count)"
}

Write-Output "正在补齐 Mooncell 缺失的公开游戏数据..."
$atlasFallbackCount = 0
foreach ($servant in $servants) {
    $id = [string]$servant.id
    $profile = $profiles[$id]
    if ($null -ne $profile -and (Test-CompleteBondPoints $profile.bondPoints)) { continue }
    try {
        $fallbackPoints = @(Get-AtlasBondPoints -CollectionNo $id)
        if (-not (Test-CompleteBondPoints $fallbackPoints)) { continue }
        if ($null -eq $profile) {
            $profile = [ordered]@{
                id = $servant.id
                name = $servant.name
                className = $servant.className
                star = $servant.star
                cost = $servant.cost
                attributes = @()
                subAttribute = $servant.subAttribute
                gender = ""
                traits = @()
                nickname = ""
                bondPoints = @($fallbackPoints)
                bondSource = "Atlas Academy"
            }
            $profiles[$id] = $profile
        } else {
            $profile.bondPoints = @($fallbackPoints)
            $profile.bondSource = "Atlas Academy"
        }
        $atlasFallbackCount += 1
    } catch {
        Write-Warning "无法补齐 $($servant.name) 的羁绊阈值：$($_.Exception.Message)"
    }
}

Write-Output "正在筛选羁绊加成礼装..."
$bondCraftEssences = @()
foreach ($record in (Parse-KeyValueRecords $craftIndexText)) {
    $description = Get-RecordValue $record 'des'
    $maxDescription = Get-RecordValue $record 'des_max'
    if ("$description $maxDescription" -notmatch '[羁牵]绊') { continue }
    $craftId = Get-RecordValue $record 'id'
    $craftCore = if ($craftCoreById.ContainsKey($craftId)) { $craftCoreById[$craftId] } else { $null }
    $title = Get-RecordValue $record 'name_link'
    if (-not $title) { $title = Get-RecordValue $record 'name' }
    $bondCraftEssences += [ordered]@{
        id = $craftId
        name = (Get-RecordValue $record 'name')
        title = $title
        star = Get-Integer (Get-RecordValue $record 'rare') (Get-Integer (Get-RecordValue $craftCore 'star'))
        cost = Get-Integer (Get-RecordValue $record 'cost') (Get-Integer (Get-RecordValue $craftCore 'cost'))
        description = Convert-CleanWikiText $description
        maxDescription = Convert-CleanWikiText $maxDescription
        avatar = Convert-ImageUrl ((Get-RecordValue $record 'avatar'), (Get-RecordValue $record 'image'), (Get-RecordValue $record 'pic'), (Get-RecordValue $craftCore 'icon') | Where-Object { $_ } | Select-Object -First 1)
        sourceUrl = "https://fgo.wiki/w/$([System.Uri]::EscapeDataString(($title -replace ' ', '_')))"
    }
}

Write-Output "正在读取各职阶冠位戴冠战..."
$grandBattles = @()
foreach ($className in @("Saber", "Archer", "Lancer", "Rider", "Caster", "Assassin", "Berserker", "Extra")) {
    $grandBattles += Parse-GrandBattles -Text (Get-WikiText "冠位戴冠战：$className/关卡配置") -ClassName $className
}

$payload = [ordered]@{
    version = 1
    syncedAt = [DateTime]::UtcNow.ToString('o')
    source = 'Mooncell'
    servants = @($servants)
    profiles = $profiles
    bondCraftEssences = @($bondCraftEssences)
    grandBattles = @($grandBattles)
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
$json = $payload | ConvertTo-Json -Depth 10 -Compress
$script = "window.FGO_MOONCELL_SNAPSHOT = $($json.Replace('</', '<\/'));`n"
[System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $outputDirectory).Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $OutputPath), $script, [System.Text.UTF8Encoding]::new($false))
Write-Output "已生成 $OutputPath：$($servants.Count) 骑从者，$($profiles.Count) 个羁绊档案，Atlas Academy 补齐 $atlasFallbackCount 个，$($bondCraftEssences.Count) 张羁绊加成礼装，$($grandBattles.Count) 个冠位关卡。"
