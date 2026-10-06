import { requireScheduler } from '../../../lib/scheduleRequest';
import { getSupabase } from '../../../lib/supabase';
import { listChannelSchedule, addEpisodeToSchedule, moveScheduleItem, removeFromSchedule, restartChannelLoop } from '../../../lib/channelSchedule';
import { parseRuntimeToSeconds } from '../../../lib/videoMetadata';

// A channel's loop (what fills time nothing is scheduled for).
// GET   ?channelId=
// POST  { channelId, episodeId }                  add to the end
// PATCH { channelId, id, action: moveUp | moveDown | remove }
// PATCH { channelId, action: restart }            start the loop over from the top
export default async function handler(req, res) {
  const channelId = req.method === 'GET' ? req.query.channelId : (req.body || {}).channelId;
  const roleContext = await requireScheduler(req, res, channelId);
  if (!roleContext) return undefined;
  const body = req.body || {};
  try {
    if (req.method === 'POST') {
      await addEpisodeToSchedule(body.episodeId, channelId);
    } else if (req.method === 'PATCH') {
      if (body.action === 'restart') {
        await restartChannelLoop(channelId);
      } else {
        // The row has to belong to this channel; the helpers look rows up by id alone.
        const { data: row } = await getSupabase().from('channel_schedule').select('channel_id').eq('id', body.id || '').maybeSingle();
        if (!row || row.channel_id !== channelId) return res.status(404).json({ error: 'That loop entry no longer exists.' });
        if (body.action === 'moveUp') await moveScheduleItem(body.id, 'up');
        else if (body.action === 'moveDown') await moveScheduleItem(body.id, 'down');
        else if (body.action === 'remove') await removeFromSchedule(body.id);
        else return res.status(400).json({ error: 'action must be moveUp, moveDown, remove or restart.' });
      }
    } else if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST, PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const rows = await listChannelSchedule(channelId);
    return res.status(200).json({
      loop: rows.map((r) => ({
        id: r.id,
        position: r.position,
        episodeId: r.episode ? r.episode.id : null,
        title: r.episode ? r.episode.title : 'Title no longer available',
        durationSeconds: r.episode ? parseRuntimeToSeconds(r.episode.runtime) || Number(r.duration_seconds) : Number(r.duration_seconds)
      }))
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

