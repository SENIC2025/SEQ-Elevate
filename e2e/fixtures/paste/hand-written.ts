/**
 * Release 4 (spec 3.8, R4-E4): clipboard HTML with links, as Word and Google
 * Docs put it on the clipboard, written by hand after their markup. The
 * clipboards captured from partners' real documents join these in this
 * folder (spec 9.8, item 3), cut down to a few lines, with no personal data
 * (mailbox addresses in safe links replaced by someone@example.org).
 *
 * WORD_LINKS: a paragraph and a list point, with every kind of anchor of
 * the paste table: https, http and mailto links; a bookmark and a footnote;
 * a link to a file on the author's computer; Outlook safe links, one whose
 * target can be used and one whose target is a file; a link to our own file
 * store (as the e2e servers see it: BLOB_PUBLIC_HOST unset); and a link
 * whose text shows another address.
 *
 * DOCS_LINKS: Google Docs' markup, its links once through Google's
 * redirect, in a paragraph and a list point.
 *
 * WORD_SAFE_LINK_TEXT: a Word link whose text is an Outlook safe link.
 */

const SAFE = (target: string) =>
  `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&amp;data=05%7C02%7Csomeone%40example.org%7C0a1b2c3d%7C0%7C0%7C638650000000000000&amp;sdata=abc%3D&amp;reserved=0`;

export const WORD_LINKS = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><style><!-- p.MsoListParagraph {mso-style-priority:34;} a:link {color:#0563C1;} --></style></head>
<body lang=EN-GB link="#0563C1" vlink="#954F72" style='tab-interval:36.0pt'>
<!--StartFragment-->
<p class=MsoNormal>See <a href="https://example.org/guide">the guide</a>, <a href="http://example.org/old"><span style='color:#0563C1'>the old site</span></a> and <a href="mailto:help@example.org">write to us</a>.<o:p></o:p></p>
<p class=MsoNormal><a name="_Toc153001"></a><a name="_Hlk153002">Introduction</a><a style='mso-footnote-id:ftn1' href="#_ftn1" name="_ftnref1" title=""><span class=MsoFootnoteReference><span style='mso-special-character:footnote'><![if !supportFootnotes]><span class=MsoFootnoteReference><span style='font-size:11.0pt'>[1]</span></span><![endif]></span></span></a> and <a href="file:///C:/Users/someone/Documents/handout.docx">the handout</a> and <a href="${SAFE("https://example.org/safe")}">the safe one</a> and <a href="${SAFE("file:///C:/Users/someone/x.docx")}">the unsafe one</a> and <a href="https://e2e-store.public.blob.vercel-storage.com/handout-paste.pdf">the uploaded one</a> and <a href="https://evil.example/login">https://bank.example/login</a>.<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Tips: <a href="https://example.org/tips">our tips</a><o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>No link here<o:p></o:p></p>
<!--EndFragment-->
</body></html>`;

/** What Word puts beside it as plain text. */
export const WORD_LINKS_TEXT =
  "See the guide, the old site and write to us.\nIntroduction[1] and the handout and the safe one and the unsafe one and the uploaded one and https://bank.example/login.\n·\tTips: our tips\n·\tNo link here";

/**
 * A Word link copied from an Outlook email: its text is the safe link itself
 * (the mailbox it was sent to in its `data`), beside a link to a file on the
 * author's computer.
 */
export const SAFE_LINK_TARGET = "https://example.org/report";
export const WORD_SAFE_LINK_TEXT = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<body lang=EN-GB link="#0563C1">
<!--StartFragment-->
<p class=MsoNormal>The report: <a href="${SAFE(SAFE_LINK_TARGET)}">${SAFE(SAFE_LINK_TARGET)}</a> and the draft <a href="file:///C:/Users/staff/draft.docx">here</a>.<o:p></o:p></p>
<!--EndFragment-->
</body></html>`;
export const WORD_SAFE_LINK_TEXT_PLAIN = `The report: ${SAFE(SAFE_LINK_TARGET).replace(/&amp;/g, "&")} and the draft here.`;

const SPAN = 'style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;white-space:pre-wrap;"';
const LINK_SPAN = 'style="font-size:11pt;font-family:Arial,sans-serif;color:#1155cc;background-color:transparent;font-weight:400;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;white-space:pre-wrap;"';
const GOOGLE = (target: string) =>
  `https://www.google.com/url?q=${target}&amp;sa=D&amp;source=editors&amp;ust=1729500000000000&amp;usg=AOvVaw0AbCdEfGhIjKlMnOpQrStU`;

export const DOCS_LINKS =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-7a1b2c3d-7fff-4e5f-8a9b-0c1d2e3f4a5b">' +
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span ${SPAN}>Read </span>` +
  `<a href="${GOOGLE("https://example.org/docs")}" style="text-decoration:none;"><span ${LINK_SPAN}>the Docs page</span></a>` +
  `<span ${SPAN}> or </span><a href="https://example.org/direct" style="text-decoration:none;"><span ${LINK_SPAN}>a direct link</span></a><span ${SPAN}>.</span></p>` +
  '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1">' +
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><a href="https://example.org/docs-list" style="text-decoration:none;"><span ${LINK_SPAN}>a listed link</span></a></p></li></ul>` +
  "</b>";

export const DOCS_LINKS_TEXT = "Read the Docs page or a direct link.\na listed link";
