'use client';

import type {
  ChatCallbackResponse,
  ChatFallbackReason,
  ChatMessageResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  buttonClass,
  CheckField,
  Dialog,
  Field,
  Icon,
  Textarea,
  TextInput,
  VisuallyHidden,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { ApiClient, ApiError } from '../../lib/api/client';
import {
  bookingPath,
  chatSessionId,
  looksLikePhone,
  stepFromAnswer,
  stepFromFailure,
} from '../../lib/chat-core';

interface Bubble {
  id: number;
  from: 'visitor' | 'assistant';
  text: string;
  /** A path to the booking page the API built from the slot the bot named. */
  book?: string | undefined;
}

type View = 'chat' | 'form' | 'sent';

const MESSAGES = '/api/v1/public/chat/messages';
const CALLBACK = '/api/v1/public/chat/callback';

/**
 * The website chat (Claude integration Wave B, design 6.3): a sheet on a phone, a dialog on a wide screen, opened from the floating
 * contact control. The visitor talks to the shop's automatic assistant; when it cannot answer (down, slow, the day's limit reached,
 * the server unreachable) the same panel offers "để lại số điện thoại": a phone number the staff call back. The conversation lives only
 * in this panel (nothing is stored here or on the server); the browser talks to the API, never to the bot. The API answers in plain
 * text and builds the booking link itself, which is opened as a path on this site.
 */
export function ChatPanel({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const t = getSiteText(locale).chat;
  const api = useMemo(() => new ApiClient(), []);
  const [view, setView] = useState<View>('chat');
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { id: 0, from: 'assistant', text: t.greeting },
  ]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState<ChatFallbackReason | 'VISITOR'>('VISITOR');
  const input = useRef<HTMLInputElement | null>(null);
  const log = useRef<HTMLDivElement | null>(null);
  const next = useRef(1);
  const session = useRef<string | null>(null);

  // Keep the newest message in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [bubbles, pending, view]);

  function sessionId(): string {
    if (session.current === null) {
      let storage: Storage | null;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = null;
      }
      session.current = chatSessionId(storage);
    }
    return session.current;
  }

  const add = (bubble: Omit<Bubble, 'id'>) =>
    setBubbles((current) => [...current, { ...bubble, id: next.current++ }]);

  function toForm(because: ChatFallbackReason | 'VISITOR') {
    setReason(because);
    setNotice(
      because === 'CAP_REACHED' ? t.fallbackCap : because === 'VISITOR' ? null : t.fallbackDown,
    );
    setView('form');
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (text === '' || pending) return;
    const honeypot = (new FormData(event.currentTarget).get('website') as string | null) ?? '';
    add({ from: 'visitor', text });
    setDraft('');
    setPending(true);
    setNotice(null);
    try {
      const answer = await api.post<ChatMessageResponse>(MESSAGES, {
        sessionId: sessionId(),
        message: text,
        locale,
        ...(honeypot === '' ? {} : { website: honeypot }),
      });
      const step = stepFromAnswer(answer);
      if (step.kind === 'REPLY') {
        add({
          from: 'assistant',
          text: step.reply,
          book: bookingPath(step.bookingUrl, window.location.origin) ?? undefined,
        });
      } else if (step.kind === 'FORM') {
        toForm(step.reason);
      }
    } catch (error) {
      const step = stepFromFailure(error);
      if (step.kind === 'WAIT') setNotice(t.wait);
      else if (step.kind === 'FORM') toForm(step.reason);
    } finally {
      setPending(false);
      input.current?.focus();
    }
  }

  return (
    <Dialog
      open
      size="md"
      title={view === 'chat' ? t.title : view === 'form' ? t.form.title : t.form.sentTitle}
      description={view === 'chat' ? t.notice : undefined}
      closeLabel={t.close}
      onClose={onClose}
      initialFocus={input}
      className="ls-chat"
      footer={
        view === 'chat' ? (
          <div className="ls-chat-composer">
            <form className="ls-chat-send" onSubmit={(event) => void send(event)}>
              <VisuallyHidden>
                <label htmlFor="ls-chat-input">{t.messageLabel}</label>
              </VisuallyHidden>
              <TextInput
                id="ls-chat-input"
                ref={input}
                value={draft}
                maxLength={500}
                placeholder={t.messagePlaceholder}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(event) => setDraft(event.target.value)}
              />
              {/* A field no person fills: a script that does is not relayed. */}
              <VisuallyHidden>
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />
              </VisuallyHidden>
              <Button
                variant="primary"
                type="submit"
                disabled={draft.trim() === ''}
                loading={pending}
              >
                {t.send}
              </Button>
            </form>
            <Button variant="secondary" icon="phone" onClick={() => toForm('VISITOR')}>
              {t.leaveNumber}
            </Button>
          </div>
        ) : null
      }
    >
      {view === 'chat' ? (
        <div
          className="ls-chat-log"
          ref={log}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {bubbles.map((bubble) => (
            <div key={bubble.id} className="ls-chat-msg" data-from={bubble.from}>
              <VisuallyHidden>{bubble.from === 'visitor' ? t.you : t.assistant}: </VisuallyHidden>
              <p className="ls-chat-text">{bubble.text}</p>
              {bubble.book ? (
                <a className={buttonClass('secondary', 'md')} href={bubble.book}>
                  <Icon name="calendar" />
                  <span className="ls-btn-label">{t.bookSlot}</span>
                </a>
              ) : null}
            </div>
          ))}
          {pending ? (
            <p className="ls-chat-typing" role="status">
              {t.typing}
            </p>
          ) : null}
          {notice ? (
            <p className="ls-chat-note" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : view === 'form' ? (
        <CallbackForm
          locale={locale}
          reason={reason}
          notice={notice}
          onBack={() => setView('chat')}
          onSent={() => setView('sent')}
        />
      ) : (
        <div className="ls-chat-sent" role="status">
          <Icon name="check" size={32} />
          <p>{t.form.sentBody}</p>
          <Button variant="primary" onClick={onClose}>
            {t.form.sentClose}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function CallbackForm({
  locale,
  reason,
  notice,
  onBack,
  onSent,
}: {
  locale: Locale;
  reason: ChatFallbackReason | 'VISITOR';
  notice: string | null;
  onBack: () => void;
  onSent: () => void;
}) {
  const t = getSiteText(locale).chat.form;
  const api = useMemo(() => new ApiClient(), []);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ phone?: string; consent?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const honeypot = (new FormData(event.currentTarget).get('website') as string | null) ?? '';
    const found: { phone?: string; consent?: string } = {};
    if (!looksLikePhone(phone)) found.phone = t.phoneError;
    if (!consent) found.consent = t.consentError;
    setErrors(found);
    setFailure(null);
    if (found.phone || found.consent) return;
    setPending(true);
    try {
      await api.post<ChatCallbackResponse>(CALLBACK, {
        phone: phone.trim(),
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        locale,
        consent: true,
        reason,
        ...(honeypot === '' ? {} : { website: honeypot }),
      });
      onSent();
    } catch (error) {
      if (error instanceof ApiError && error.field === 'phone') {
        setErrors({ phone: t.phoneError });
      } else {
        setFailure(t.sendError);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ls-chat-form" noValidate onSubmit={(event) => void submit(event)}>
      {notice ? <p className="ls-chat-note">{notice}</p> : null}
      <Field
        label={t.phone}
        hint={t.phoneExample}
        {...(errors.phone ? { error: errors.phone } : {})}
        required
      >
        {(control) => (
          <TextInput
            {...control}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            value={phone}
            disabled={pending}
            onChange={(event) => setPhone(event.target.value)}
          />
        )}
      </Field>
      <Field label={t.name}>
        {(control) => (
          <TextInput
            {...control}
            autoComplete="name"
            maxLength={80}
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label={t.note}>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={500}
            value={note}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      <VisuallyHidden>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      </VisuallyHidden>
      <CheckField
        label={t.consent}
        checked={consent}
        invalid={Boolean(errors.consent)}
        disabled={pending}
        onChange={(event) => setConsent(event.target.checked)}
      />
      {errors.consent ? (
        <p className="ls-chat-error" role="alert">
          {errors.consent}
        </p>
      ) : null}
      {failure ? (
        <p className="ls-chat-error" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="ls-chat-form-actions">
        <Button variant="secondary" onClick={onBack} disabled={pending}>
          {t.back}
        </Button>
        <Button variant="primary" type="submit" loading={pending}>
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
    </form>
  );
}
