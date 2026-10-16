import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function readResume(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a resume under 5 MB.');
  const extension = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();
  let text = '';
  if (extension === 'pdf') {
    const task = getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 30) throw new Error('Choose a resume with 30 pages or fewer.');
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n';
      }
    } finally { await task.destroy(); }
  } else if (extension === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  else if (extension === 'txt') text = new TextDecoder().decode(buffer);
  else throw new Error('Use a PDF, DOCX, or TXT file.');
  if (text.trim().length < 40) throw new Error('No usable text found. Scanned PDFs need OCR first; try DOCX or paste your resume text.');
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return { name: file.name, type: file.type || ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' }[extension]), base64: btoa(binary), text: text.trim(), updatedAt: Date.now() };
}
