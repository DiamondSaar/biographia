// По запросу пользователя - при составлении записи (как и в инструкциях
// портала) должно хватать Ctrl+V, чтобы вставить скриншот из буфера как
// вложение, без отдельного "Выбрать файл" через проводник.
//
// Возвращает File, если в буфере была картинка (иначе null) - её остаётся
// просто добавить в тот же список files, что и обычный выбор файла.
// Браузер отдаёт содержимое буфера под голым именем вроде "image.png" -
// подставляем более узнаваемое имя с меткой времени, чтобы несколько
// вставленных подряд скриншотов не выглядели одинаково в списке вложений.
export function extractImageFromClipboard(event) {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) continue;
      const ext = item.type.split("/")[1] || "png";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      return new File([file], `вставлено-${stamp}.${ext}`, { type: item.type });
    }
  }
  return null;
}
