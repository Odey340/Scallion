import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side only: calls Gemini's vision API to estimate carbs from a plate photo.
 * GEMINI_API_KEY lives in Vercel project env vars, never in client code or EXPO_PUBLIC_*,
 * so it is never bundled into the browser JS. Lane C is building this in place of Lane D's
 * planned Gemini extraction (contract has no route for it yet) — see docs/log/C.md.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

const PROMPT = `You are looking at a photo of a plate of food. Estimate the total carbohydrate content in grams for
everything visible on the plate, using typical portion sizes. Respond with strict JSON only, no markdown fences:
{"carbs_g": <number>, "food_description": "<short plain-English description of what's on the plate>",
"confidence": "low"|"medium"|"high"}`;

interface GeminiEstimate {
  carbs_g: number;
  food_description: string;
  confidence: 'low' | 'medium' | 'high';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'server_missing_gemini_key' });
    return;
  }

  const { imageBase64, mimeType } = req.body ?? {};
  if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string') {
    res.status(400).json({ error: 'missing_image' });
    return;
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
            },
          ],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const detail = await geminiResponse.text();
      res.status(502).json({ error: 'gemini_request_failed', detail: detail.slice(0, 500) });
      return;
    }

    const data = await geminiResponse.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: 'gemini_empty_response' });
      return;
    }

    const parsed = JSON.parse(text) as GeminiEstimate;
    if (typeof parsed.carbs_g !== 'number') {
      res.status(502).json({ error: 'gemini_unparseable_response' });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: 'gemini_call_threw', detail: err instanceof Error ? err.message : String(err) });
  }
}
