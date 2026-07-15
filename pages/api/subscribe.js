import fs from 'fs';
import path from 'path';

// Where fan signups go. If NOTION_TOKEN + NOTION_DATABASE_ID are set, they're
// written straight into a Notion database (a natural fit if you're already
// running an Artist Hub in Notion). Otherwise they fall back to a local JSON
// file, which is fine for local testing but won't persist on serverless hosts
// like Vercel — swap in Notion, or an ESP like Mailchimp/ConvertKit, before
// you rely on this for real fans.

const DATA_FILE = path.join(process.cwd(), 'signals.local.json');

async function saveToNotion(email, character) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        // Adjust these property names to match your Notion database's schema.
        Name: { title: [{ text: { content: email } }] },
        Character: { select: { name: character } },
        Source: { rich_text: [{ text: { content: 'Taprino Transmission signup' } }] }
      }
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API error: ${body}`);
  }
}

function saveToLocalFile(entry) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    list = [];
  }
  list.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
  return list;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, character } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A real email address is required.' });
  }

  const entry = { email, character: character || 'Undecided', ts: Date.now() };

  try {
    if (process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID) {
      await saveToNotion(email, entry.character);
    } else {
      saveToLocalFile(entry);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe error:', err.message);
    return res.status(500).json({ error: 'Could not save signup right now.' });
  }
}
