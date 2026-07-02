@echo off
chcp 65001 >nul
title Maket CP — Переименование фотографий
echo ==================================================
echo   Maket CP — Переименование фотографий
echo ==================================================
echo.

:: Найти CSV-файл rename_*.csv в текущей папке
set "CSV_FILE="
for %%f in (rename_*.csv) do (
    set "CSV_FILE=%%f"
    goto :found_csv
)

:: Если не нашли rename_*.csv, ищем любой .csv
for %%f in (*.csv) do (
    set "CSV_FILE=%%f"
    goto :found_csv
)

echo CSV-файл не найден.
echo Положите rename_*.csv в эту папку и запустите снова.
echo.
pause
exit /b 1

:found_csv
echo CSV-файл: %CSV_FILE%
echo.

:: Запустить PowerShell для обработки
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
  "$csv = Import-Csv -Path '%CSV_FILE%' -Encoding UTF8;" ^
  "$total = $csv.Count;" ^
  "$found = 0; $renamed = 0; $errors = @(); $notfound = @();" ^
  "Write-Host ('Файлов в списке: ' + $total);" ^
  "Write-Host '';" ^
  "Write-Host 'Предпросмотр:';" ^
  "$preview = 0;" ^
  "foreach ($row in $csv) {" ^
  "  $old = $row.old_name;" ^
  "  $new = $row.new_name;" ^
  "  if (-not $old -or -not $new) { continue }" ^
  "  $path = Get-ChildItem -Path . -Filter $old -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "  if ($path) {" ^
  "    $found++;" ^
  "    if ($preview -lt 15) { Write-Host ('  ' + $old + ' -> ' + $new); $preview++ }" ^
  "  } else { $notfound += $old }" ^
  "}" ^
  "if ($found -gt 15) { Write-Host ('  ... и ещё ' + ($found - 15)) }" ^
  "if ($notfound.Count -gt 0) { Write-Host ('Не найдено: ' + $notfound.Count) }" ^
  "Write-Host '';" ^
  "Write-Host ('Будет переименовано: ' + $found + ' файлов');" ^
  "$confirm = Read-Host 'Продолжить? (да/нет)';" ^
  "if ($confirm -notin @('да','yes','y','д')) { Write-Host 'Отменено.'; exit }" ^
  "$log = @('Maket CP Rename Log — ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), 'CSV: %CSV_FILE%', '');" ^
  "foreach ($row in $csv) {" ^
  "  $old = $row.old_name; $new = $row.new_name;" ^
  "  if (-not $old -or -not $new) { continue }" ^
  "  $path = Get-ChildItem -Path . -Filter $old -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "  if (-not $path) { continue }" ^
  "  $targetDir = $path.DirectoryName;" ^
  "  $newPath = Join-Path $targetDir $new;" ^
  "  if (Test-Path $newPath) { $log += ('SKIP: ' + $old + ' (файл ' + $new + ' уже существует)'); continue }" ^
  "  try { Rename-Item -Path $path.FullName -NewName $new -ErrorAction Stop; $renamed++; $log += ('OK: ' + $old + ' -> ' + $new) }" ^
  "  catch { $errors += $old; $log += ('FAIL: ' + $old + ' -> ' + $new + ' (' + $_.Exception.Message + ')') }" ^
  "}" ^
  "Write-Host '';" ^
  "Write-Host ('Готово! Переименовано: ' + $renamed);" ^
  "if ($errors.Count -gt 0) { Write-Host ('Ошибки: ' + $errors.Count) }" ^
  "$log += ('', 'Итого переименовано: ' + $renamed);" ^
  "$log | Out-File -FilePath 'rename_log.txt' -Encoding UTF8;" ^
  "Write-Host 'Лог: rename_log.txt'"

echo.
pause
