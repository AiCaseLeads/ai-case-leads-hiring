"use client";
import { useEffect, useRef, useState } from 'react';
import { SafeDescription } from '../careers/safe-description';
import { cleanDescriptionSpacing, sanitizeJobDescription, serializeDescriptionEditor } from '@/lib/job-description';

export function DescriptionEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);
  const selection = useRef<Range | null>(null);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (editor.current && (editor.current.innerHTML === '' || value !== lastValue.current)) {
      editor.current.innerHTML = sanitizeJobDescription(value);
      lastValue.current = value;
    }
  }, [value]);
  function rememberSelection() {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
  }
  function focusSelection() {
    editor.current?.focus();
    if (selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) {
      const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(selection.current);
    }
  }
  function publish() {
    if (!editor.current) return;
    const html = serializeDescriptionEditor(editor.current.innerHTML);
    lastValue.current = html; onChange(html); rememberSelection();
  }
  function command(name: string, argument?: string) {
    focusSelection(); document.execCommand(name, false, argument); publish(); setMessage('');
  }
  function cleanup() {
    if (!editor.current) return;
    focusSelection();
    const cleaned = cleanDescriptionSpacing(editor.current.innerHTML);
    const range = document.createRange(); range.selectNodeContents(editor.current);
    const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range);
    // insertHTML retains native browser undo, unlike replacing innerHTML.
    document.execCommand('insertHTML', false, cleaned); publish();
    setMessage('Extra spaces and empty paragraphs removed. Use Undo to restore them.');
  }
  return <div className="description-editor">
    <div className="description-toolbar" role="toolbar" aria-label="Job description formatting">
      {([['Bold', 'bold'], ['Italic', 'italic'], ['Heading', 'formatBlock', 'h2'], ['Paragraph', 'formatBlock', 'p'], ['Bulleted list', 'insertUnorderedList'], ['Numbered list', 'insertOrderedList'], ['Undo', 'undo'], ['Redo', 'redo']] as const).map(([label, action, arg]) =>
        <button key={label} type="button" disabled={preview} onMouseDown={(event) => event.preventDefault()} onClick={() => command(action, arg)}>{label}</button>)}
      <button type="button" disabled={preview} onMouseDown={(event) => event.preventDefault()} onClick={cleanup}>Clean up spacing</button>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Back to editing' : 'Preview'}</button>
    </div>
    <div hidden={preview}>
      <div ref={editor} className="description-editable description-copy" contentEditable suppressContentEditableWarning role="textbox" aria-label="Job description" aria-multiline="true" aria-describedby="job-description-help" onInput={publish} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onBlur={rememberSelection} onDrop={(event) => {
        event.preventDefault(); focusSelection(); document.execCommand('insertText', false, event.dataTransfer.getData('text/plain')); publish();
      }} onPaste={(event) => {
        event.preventDefault(); focusSelection(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); publish();
      }} />
    </div>
    {preview && <div className="description-preview" aria-label="Job description preview"><SafeDescription html={value} /></div>}
    <p id="job-description-help" className="description-help">Select text to format it. Paste brings in text without outside styling. Clean up spacing removes extra spaces and blank paragraphs; Undo restores them.</p>
    {message && <p role="status" className="description-help">{message}</p>}
  </div>;
}
