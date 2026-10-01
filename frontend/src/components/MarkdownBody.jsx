import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

// По запросу пользователя - раньше тело записи выводилось как
// <p>{body}</p>: один текстовый узел, браузер молча схлопывал все переносы
// строк, и структурированный текст (заголовки, списки, нумерация) превращался
// в сплошную стену. Решение - то же самое, что уже работает в инструкциях
// портала атб (D:\projects\atb-portal): хранить body как markdown-исходник
// как есть (без миграции - колонка и так просто текст), рендерить в HTML при
// показе. Портал делает это на сервере (Python markdown + nh3), здесь -
// на клиенте (SPA, не Jinja2): marked (парсер) + DOMPurify (тот же принцип
// санитайзера, что nh3 - вырезать небезопасный HTML перед вставкой в DOM).
marked.setOptions({ breaks: true, gfm: true });

export default function MarkdownBody({ text, className }) {
  const html = useMemo(() => {
    if (!text) return "";
    return DOMPurify.sanitize(marked.parse(text));
  }, [text]);

  if (!html) return null;
  // eslint-disable-next-line react/no-danger
  return <div className={`markdown-body${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
