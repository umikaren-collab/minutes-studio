export const paperSizes = { A4: [210, 297], A3: [297, 420], B5: [182, 257] };
export const toTwips = (mm) => Math.round((mm * 1440) / 25.4);
export function printSettings(raw = {}) {
  const paper = paperSizes[raw.paper] ? raw.paper : 'A4';
  const orientation = raw.orientation === 'landscape' ? 'landscape' : 'portrait';
  const margin = Number(raw.margin ?? 20),
    fontSize = Number(raw.fontSize ?? 11),
    lineSpacing = Number(raw.lineSpacing ?? 1.15);
  if (
    ![10, 15, 20, 25, 30].includes(margin) ||
    ![10, 10.5, 11, 12, 14].includes(fontSize) ||
    ![1, 1.15, 1.5, 2].includes(lineSpacing)
  )
    throw Error('印刷設定の値を確認してください。');
  return { paper, orientation, margin, fontSize, lineSpacing };
}
export function sectionPrint(settings) {
  const s = printSettings(settings),
    [w, h] = paperSizes[s.paper];
  return {
    size: { width: toTwips(w), height: toTwips(h), orientation: s.orientation },
    margin: {
      top: toTwips(s.margin),
      bottom: toTwips(s.margin),
      left: toTwips(s.margin),
      right: toTwips(s.margin),
    },
  };
}
export function applyTemplatePrint(xml, settings, Parser = DOMParser, Serializer = XMLSerializer) {
  const s = printSettings(settings),
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document = new Parser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw Error('Wordのページ設定を読み込めません。');
  const body = document.getElementsByTagNameNS(ns, 'body')[0];
  if (!body) throw Error('Wordの本文を読み込めません。');
  let sections = Array.from(document.getElementsByTagNameNS(ns, 'sectPr'));
  if (!sections.length) {
    const node = document.createElementNS(ns, 'w:sectPr');
    body.appendChild(node);
    sections = [node];
  }
  const [w, h] = paperSizes[s.paper].map(toTwips);
  for (const section of sections) {
    let size = Array.from(section.childNodes).find(
      (n) => n.namespaceURI === ns && n.localName === 'pgSz',
    );
    if (!size) {
      size = document.createElementNS(ns, 'w:pgSz');
      section.insertBefore(size, section.firstChild);
    }
    size.setAttributeNS(ns, 'w:w', String(s.orientation === 'landscape' ? h : w));
    size.setAttributeNS(ns, 'w:h', String(s.orientation === 'landscape' ? w : h));
    size.setAttributeNS(ns, 'w:orient', s.orientation);
    size.removeAttributeNS(ns, 'code');
    let margin = Array.from(section.childNodes).find(
      (n) => n.namespaceURI === ns && n.localName === 'pgMar',
    );
    if (!margin) {
      margin = document.createElementNS(ns, 'w:pgMar');
      section.insertBefore(margin, size.nextSibling);
    }
    for (const side of ['top', 'bottom', 'left', 'right'])
      margin.setAttributeNS(ns, 'w:' + side, String(toTwips(s.margin)));
  }
  return new Serializer().serializeToString(document);
}
