'use client';

import {
  useId,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button } from './button';
import { cx } from './cx';
import { Notice, ProgressBar } from './feedback';
import { Icon } from './icons';
import {
  DEFAULT_IMAGE_TYPES,
  formatBytes,
  precheckDimensions,
  precheckFile,
  readImageSize,
  uploaderReducer,
  type UploadedImage,
} from './image-core';

/**
 * File picker + drop target. The zone is a button, so Enter and Space open the file dialog.
 * It reports files only; validation and upload belong to the owner (`ImageUploader`).
 */
export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  inputRef,
  describedById,
  className,
  children,
}: {
  /** MIME types, e.g. `image/webp`. */
  accept: readonly string[];
  multiple?: boolean | undefined;
  disabled?: boolean | undefined;
  onFiles: (files: File[]) => void;
  inputRef?: Ref<HTMLInputElement> | undefined;
  describedById?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const own = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <div
      className={cx('ls-dropzone', dragging && 'ls-dropzone-dragging', className)}
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <button
        type="button"
        className="ls-dropzone-button"
        disabled={disabled}
        aria-describedby={describedById}
        onClick={() => own.current?.click()}
      >
        {children}
      </button>
      <input
        ref={(element) => {
          own.current = element;
          if (typeof inputRef === 'function') inputRef(element);
          else if (inputRef) inputRef.current = element;
        }}
        type="file"
        hidden
        tabIndex={-1}
        multiple={multiple}
        accept={accept.join(',')}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Allow choosing the same file again after a failure.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

export interface ImageUploaderLabels {
  choose: string;
  replace: string;
  remove: string;
  cancel: string;
  retry: string;
  /** Second line in the empty zone, e.g. "or drop an image here". */
  drop: string;
  /** Accessible name of the progress bar. */
  uploading: string;
  errorType: string;
  errorSize: string;
  errorDimensions: string;
  /** Fallback when `upload` fails and `describeError` is not given. */
  errorUpload: string;
}

/**
 * Presentational uploader (states: empty, dragging, uploading, uploaded, error). The API client
 * stays in the app: pass `upload(file)`. Nothing is persisted here; `onChange` reports the result.
 */
export function ImageUploader({
  value,
  onChange,
  upload,
  labels,
  hint,
  accept = DEFAULT_IMAGE_TYPES,
  maxBytes,
  minWidth,
  minHeight,
  describeError,
  decimalSeparator,
  disabled,
  className,
}: {
  value: UploadedImage | null;
  onChange: (value: UploadedImage | null) => void;
  upload: (
    file: File,
    control: { onProgress: (percent: number) => void; signal: AbortSignal },
  ) => Promise<UploadedImage>;
  labels: ImageUploaderLabels;
  /** Accepted types, size limit and recommended size in words, e.g. "1920 x 800 px, under 10 MB". */
  hint: string;
  accept?: readonly string[] | undefined;
  maxBytes: number;
  minWidth?: number | undefined;
  minHeight?: number | undefined;
  describeError?: ((error: unknown) => string) | undefined;
  /** `,` for Vietnamese file sizes. */
  decimalSeparator?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const [state, dispatch] = useReducer(uploaderReducer, { status: 'idle' });
  const picker = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastFile = useRef<File | null>(null);
  const hintId = useId();

  async function run(file: File) {
    lastFile.current = file;
    const problem = precheckFile(file, { accept, maxBytes });
    if (problem) {
      dispatch({
        type: 'fail',
        message: problem === 'type' ? labels.errorType : labels.errorSize,
        retryable: false,
      });
      return;
    }
    if (minWidth !== undefined || minHeight !== undefined) {
      const size = await readImageSize(file);
      if (size && precheckDimensions(size, { minWidth, minHeight })) {
        dispatch({ type: 'fail', message: labels.errorDimensions, retryable: false });
        return;
      }
    }
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: 'start', fileName: file.name });
    try {
      const uploaded = await upload(file, {
        onProgress: (percent) => dispatch({ type: 'progress', progress: percent }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      dispatch({ type: 'reset' });
      onChange(uploaded);
    } catch (failure) {
      if (controller.signal.aborted) return;
      dispatch({
        type: 'fail',
        message: describeError ? describeError(failure) : labels.errorUpload,
        retryable: true,
      });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  const acceptedFiles = (files: File[]) => {
    const file = files[0];
    if (file) void run(file);
  };

  if (state.status === 'uploading') {
    return (
      <div className={cx('ls-uploader', className)} aria-live="polite">
        <p className="ls-uploader-name">{state.fileName}</p>
        <ProgressBar
          label={labels.uploading}
          value={state.progress === null ? undefined : state.progress}
        />
        <Button
          variant="ghost"
          onClick={() => {
            abort.current?.abort();
            dispatch({ type: 'reset' });
          }}
        >
          {labels.cancel}
        </Button>
      </div>
    );
  }

  return (
    <div className={cx('ls-uploader', className)}>
      {state.status === 'error' ? (
        <Notice tone="danger">
          <p className="ls-notice-text">{state.message}</p>
          {state.retryable && lastFile.current ? (
            <Button variant="secondary" onClick={() => void run(lastFile.current!)}>
              {labels.retry}
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {value ? (
        <div className="ls-uploaded" aria-live="polite">
          {/* The name is text next to the thumbnail, so the image itself is decorative. Library
              images are already resized, and this package cannot use next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ls-uploaded-thumb" src={value.url} alt="" />
          <div className="ls-uploaded-info">
            <p className="ls-uploaded-name">{value.name}</p>
            <p className="ls-hint">
              {formatBytes(value.sizeBytes, decimalSeparator)}
              {value.width && value.height ? ` · ${value.width} × ${value.height}` : ''}
            </p>
            <div className="ls-uploaded-actions">
              <input
                ref={picker}
                type="file"
                hidden
                tabIndex={-1}
                accept={accept.join(',')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void run(file);
                }}
              />
              <Button
                variant="secondary"
                icon="upload"
                disabled={disabled}
                onClick={() => picker.current?.click()}
              >
                {labels.replace}
              </Button>
              <Button
                variant="danger-outline"
                icon="trash"
                disabled={disabled}
                onClick={() => onChange(null)}
              >
                {labels.remove}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <FileDropzone
            accept={accept}
            disabled={disabled}
            onFiles={acceptedFiles}
            describedById={hintId}
          >
            <Icon name="image" size={28} />
            <span className="ls-dropzone-title">{labels.choose}</span>
            <span className="ls-dropzone-sub">{labels.drop}</span>
          </FileDropzone>
          <p className="ls-hint" id={hintId}>
            {hint}
          </p>
        </>
      )}
    </div>
  );
}
