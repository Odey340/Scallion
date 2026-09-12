/**
 * Browser-only Gmail OAuth ingest (Google Identity Services token client, `gmail.metadata`
 * scope — never message bodies). No backend involved in reading Gmail; the API only ever sees
 * the anonymized Events this produces (POST /events). Web-only, same reasoning as lib/salt.ts.
 */
import type { GmailMetadataMessage } from '@/lib/social';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Date', 'In-Reply-To'];
const PAGE_SIZE = 100;
const FETCH_CONCURRENCY = 10;

interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleAccounts {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (resp: TokenResponse) => void;
      }): { requestAccessToken: (opts?: { prompt?: string }) => void };
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/**
 * Opens the Google OAuth consent popup and resolves with a short-lived access token. With
 * `silent: true`, asks for a token with no prompt at all — works only once this scope was
 * already granted earlier in the tab's session.
 */
export async function requestGmailAccessToken(clientId: string, opts: { silent?: boolean } = {}): Promise<string> {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'No access token returned.'));
          return;
        }
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken(opts.silent ? { prompt: '' } : undefined);
  });
}

async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail API request failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

interface MessagesListResponse {
  messages?: { id: string }[];
  nextPageToken?: string;
}

async function listMessageIds(accessToken: string, maxMessages: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    params.append('labelIds', 'INBOX');
    params.append('labelIds', 'SENT');
    if (pageToken) params.set('pageToken', pageToken);

    const page = await gmailGet<MessagesListResponse>(`/messages?${params.toString()}`, accessToken);
    for (const m of page.messages ?? []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < maxMessages);

  return ids.slice(0, maxMessages);
}

function fetchMessageMetadata(id: string, accessToken: string): Promise<GmailMetadataMessage> {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const h of METADATA_HEADERS) params.append('metadataHeaders', h);
  return gmailGet<GmailMetadataMessage>(`/messages/${id}?${params.toString()}`, accessToken);
}

/**
 * Fetches recent INBOX + SENT messages (metadata only — no body is ever requested or accessible
 * under the gmail.metadata scope), most recent first, up to `maxMessages`.
 */
export async function fetchRecentMessages(accessToken: string, maxMessages = 500): Promise<GmailMetadataMessage[]> {
  const ids = await listMessageIds(accessToken, maxMessages);
  const messages: GmailMetadataMessage[] = [];

  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + FETCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((id) => fetchMessageMetadata(id, accessToken)));
    messages.push(...batchResults);
  }

  return messages;
}
