import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { LIMITS } from '../../../shared/protocol';
import { SendIcon } from './Icons';

interface Props {
  disabled: boolean;
  onSend(text: string): boolean;
  onTyping(): void;
}

const MAX = LIMITS.maxMessageChars;

export function Composer({ disabled, onSend, onTyping }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to the CSS max-height; re-measure whenever the text changes.
  // oxlint-disable-next-line react/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (disabled || !text.trim()) return;
    if (onSend(text)) setText('');
    ref.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a newline; never interrupt IME composition.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const remaining = MAX - text.length;

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        ref={ref}
        rows={1}
        value={text}
        maxLength={MAX}
        placeholder={disabled ? 'Connecting…' : 'Write a message'}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value) onTyping();
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        enterKeyHint="send"
        aria-describedby={remaining < 200 ? 'composer-count' : undefined}
      />
      {remaining < 200 && (
        <span id="composer-count" className={`composer-count ${remaining < 20 ? 'is-low' : ''}`}>
          {remaining}
        </span>
      )}
      <button className="send-btn" type="submit" disabled={disabled || !text.trim()} aria-label="Send message">
        <SendIcon size={18} />
      </button>
    </form>
  );
}
