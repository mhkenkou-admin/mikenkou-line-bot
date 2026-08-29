import crypto from "node:crypto";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

function verifySignature(body, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  if (!signature) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replyLine(replyToken, text) {
  const response = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 5000) }],
    }),
  });

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status}`);
  }
}

async function askOpenAI(message) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions:
        "あなたは未来建築工芸（MIKENKOU）のLINEアシスタントです。日本語で、わかりやすく簡潔に回答してください。",
      input: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI failed: ${response.status}`);
  }

  const data = await response.json();
  return data.output_text || "申し訳ありません。回答を作成できませんでした。";
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("MIKENKOU LINE BOT OK");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const signature = req.headers["x-line-signature"];

    if (!verifySignature(rawBody, signature)) {
      return res.status(401).send("Invalid signature");
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    res.status(200).send("OK");

    for (const event of body.events || []) {
      if (
        event.type === "message" &&
        event.message?.type === "text" &&
        event.replyToken
      ) {
        const answer = await askOpenAI(event.message.text);
        await replyLine(event.replyToken, answer);
      }
    }
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      return res.status(500).send("Server Error");
    }
  }
}
