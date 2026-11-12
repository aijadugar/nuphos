import clsx from 'clsx'
import { FileText, Play } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'

import { MEDIA_BOX, MEDIA_FRAME } from './transferDownloads'

import type { ViewerKind } from './transferDownloads'
import type { FileTransferFile } from '../../../types'

// The most of a PDF a preview reads into memory. Media streams from its URL and
// is never read whole; a PDF has to be, so a bigger one is left to Download.
export const PDF_PREVIEW_BYTES_MAX = 25 * 1024 * 1024

/**
 * A file the agent sent, shown in chat as what it is, at the chat's media size:
 * an image, a video or a PDF is a square the caller's lightbox opens full size;
 * an audio file plays in place with the browser's own controls. A file with no
 * viewer of its own keeps the image slot it had — offered rather than run.
 */
export function MediaPreview({
  file,
  kind,
  alt,
  onOpen,
  onError,
}: {
  file: FileTransferFile
  /** What it is, from `viewerKind`; null when nothing renders it in place. */
  kind: ViewerKind | null
  alt?: string
  /** Opens the file full size: the lightbox belongs to the caller. */
  onOpen: () => void
  /** It cannot be shown or played: the caller shows what it shows for a broken file. */
  onError: () => void
}) {
  const url = file.downloadUrl
  const name = alt ?? file.fileName

  if (!url) return null

  if (kind === 'video')
    return <VideoThumb url={url} name={name} onOpen={onOpen} onError={onError} />
  if (kind === 'audio')
    return (
      <audio
        src={url}
        controls
        preload="metadata"
        aria-label={name}
        onError={onError}
        className="w-full max-w-md"
      />
    )
  if (kind === 'pdf')
    return (
      <button
        type="button"
        onClick={onOpen}
        title={name}
        aria-label={t('Preview {name}', { name })}
        className={clsx(
          MEDIA_FRAME,
          'flex cursor-zoom-in items-center justify-center text-red-500',
        )}
      >
        <FileText className="h-6 w-6" />
      </button>
    )

  return (
    <button type="button" onClick={onOpen} aria-label={t('Preview {name}', { name })}>
      <img src={url} alt={name} onError={onError} className={`object-cover ${MEDIA_FRAME}`} />
    </button>
  )
}

/** A video's first frame in the media square, with a play badge; it plays full size. */
export function VideoThumb({
  url,
  name,
  onOpen,
  onError,
}: {
  url: string
  name: string
  onOpen: () => void
  onError?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={name}
      aria-label={t('Play {name}', { name })}
      className={clsx(
        MEDIA_BOX,
        'relative flex-shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-line-control bg-black',
      )}
    >
      <video
        src={url}
        preload="metadata"
        muted
        onError={onError}
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" strokeWidth={2} />
        </span>
      </span>
    </button>
  )
}

/** Where a PDF's bytes come from: one file of a transfer group. */
export type PdfSource = {
  teamId: string
  groupId: string
  fileId: string
  /** The size the file's record states, if any. */
  size: number | null
}

/**
 * A PDF in a frame of its own, drawn full size by the lightbox. The main
 * process reads the bytes: the store sends no CORS headers, and its link is
 * served as an attachment, so neither `fetch` nor framing the link works here.
 *
 * No `sandbox`: Chromium refuses its PDF viewer in any sandbox without
 * `allow-scripts` (ERR_BLOCKED_BY_CLIENT). Wrapping the bytes as
 * `application/pdf` keeps the type certain, so nothing else is framed. The read
 * is bounded by {@link PDF_PREVIEW_BYTES_MAX}; over it, or when the file is
 * gone, the frame says so.
 */
export function PdfFrame({ source, name }: { source: PdfSource; name: string }) {
  const { teamId, groupId, fileId, size } = source
  const [blob, setBlob] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let made: string | undefined
    const fail = () => {
      if (active) setFailed(true)
    }

    // A size the record already rules out is never read at all.
    if (size !== null && size > PDF_PREVIEW_BYTES_MAX) {
      fail()

      return
    }
    void api
      .fileTransferReadOne({ teamId, groupId, fileId, maxBytes: PDF_PREVIEW_BYTES_MAX })
      .then((bytes) => {
        if (!active) return
        if (!bytes) {
          fail()

          return
        }
        // The type is stated here on purpose, rather than taken from the
        // store: whatever it said, the frame is handed a PDF.
        made = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setBlob(made)
      }, fail)

    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [teamId, groupId, fileId, size])

  if (failed)
    return (
      <span role="status" className="text-[13px] text-white/80">
        {t('Preview unavailable')}
      </span>
    )

  return blob ? (
    <iframe src={blob} title={name} className="h-full w-full rounded-lg bg-white shadow-2xl" />
  ) : (
    <span role="status" aria-label={t('Loading {name}', { name })} />
  )
}
