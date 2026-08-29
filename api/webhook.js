import crypto from "node:crypto";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

function verifySignature(rawBody, signature) {
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");

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
      messages: [
        {
          type: "text",
          text,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LINE error: ${response.status} ${errorText}`);
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
      model: "gpt-5-mini",
      input: message,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  if (data.output_text) {
    return data.output_text;
  }

  const text = data.output
    ?.flatMap((item) => item.content || [])
    ?.filter((item) => item.type === "output_text")
    ?.map((item) => item.text)
    ?.join("\n");

  return text || "すみません。回答を作れませんでした。";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("MIKENKOU LINE BOT");
  }

  try {
    const rawBody =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const signature = req.headers["x-line-signature"];

    if (!verifySignature(rawBody, signature)) {
      return res.status(401).send("Invalid signature");
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    for (const event of body.events || []) {
      if (event.source?.userId !== process.env.OWNER_LINE_USER_ID) {

  continue;

}
      if (
        event.type === "message" &&
        event.message?.type === "text" &&
        event.replyToken
      ) {
        const answer = await askOpenAI(event.message.text);
        await replyLine(event.replyToken, answer);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      return res.status(500).send("Server error");
    }
  }
}