import AdminShell from '../../components/AdminShell';
import { adminPageProps } from '../../lib/adminPage';
import { AI_POLICY_PATH } from '../../lib/aiPolicyRules';
import {
  Card, Chip, Tile, SwitchRow, ProtectionRun, useSwitches, shortDay,
  VideosResult, CaptionsResult, UniversityResult, PostsResult, PodcastsResult
} from '../../components/admin/SecurityBits';
import { AiSealChip } from '../../components/AiSeal';

// Admin → AI security (Jose, 2026-11-05: "add a toggle to have the screen
// shots under admin … under security/ai security"; signed off on the
// canvas https://claude.ai/artifact/QaHCfmHVD764ti3WNy7ajC): keeping
// creators' work from being copied or used to train AI. The screenshot
// switch and the four "older uploads" runs moved here from Admin →
// Settings → Protection; "Block AI answer engines" was a constant in
// lib/robotsRules.js and is now site_settings.block_ai_search
// (migration 119). Full admins only.
export async function getServerSideProps(ctx) {
  return adminPageProps(ctx, {
    extra: async () => {
      const { getAiSecurityPage } = await import('../../lib/securityPage');
      return { data: await getAiSecurityPage() };
    }
  });
}

export default function AdminAiSecurity({ account, mainGenres, data }) {
  const { switches, busy, errors, flip } = useSwitches(data.switches);
  const capture = switches.screenCaptureBlock;
  const answer = switches.blockAiSearch;
  const runs = data.runs || {};
  const runKeys = ['videos', 'captions', 'university', 'posts', 'podcasts'];
  const ranCount = runKeys.filter((k) => runs[k]).length;
  const crawlersBlocked = data.crawlers.training + (answer.on ? data.crawlers.answer : 0);
  const changed = data.captureChanged;

  return (
    <AdminShell account={account} mainGenres={mainGenres} title="AI security" crumbs={['Security']}
      intro="Keeping creators’ work from being copied or used to train AI. Signed links and private storage are locks; robots rules and headers are requests the big companies say they honour. Nothing stops a camera pointed at a screen.">
      <div className="sec-tiles">
        <Tile label="Screenshots in the app" value={capture.on ? 'Blocked' : 'Allowed'} tone={capture.on ? 'ok' : 'warn'} />
        <Tile label="AI crawlers blocked" value={`${crawlersBlocked} of ${data.crawlers.training + data.crawlers.answer}`} tone={answer.on ? 'ok' : 'plain'} />
        <Tile label="Older uploads locked" value={`${ranCount} of ${runKeys.length} run`} tone={ranCount === runKeys.length ? 'ok' : 'warn'} />
        <Tile label="The seal" value={data.seal ? `${data.seal.creators - data.seal.off} of ${data.seal.creators} creators` : '—'} tone="plain" />
      </div>

      <div className="sec-grid">
        <Card eyebrow="In the app" title="Screenshots and screen recording" id="ai-app">
          <SwitchRow
            first field="screenCaptureBlock" title="Block screenshots and screen recording" state={capture} busy={busy} error={errors.screenCaptureBlock} onFlip={flip}
            lock={capture.envOff ? 'SCREEN_CAPTURE_BLOCK=off is set in Vercel, which keeps the block off whatever this says. Remove the variable there to hand it to this switch.' : null}
          >
            <p className="sec-p">On: a screenshot or recording of a playing title, Snippet, lesson video, self-tape or open photo post comes out black in the app (Android also hides the app in the recents screen). Off: allowed everywhere, for everyone. An open app picks the change up within about a minute. The same switch is on the app&rsquo;s Admin tab.</p>
            {changed && <p className={`sec-p small${capture.on ? '' : ' warn'}`}>{capture.on ? 'On' : 'Off'} since {shortDay(changed.at)}{changed.by ? `, switched by ${changed.by.split('@')[0]}` : ''}.</p>}
          </SwitchRow>
          <p className="sec-p small">A website can&rsquo;t block a screenshot; there the right-click and long-press saves are off on Snippets and photos instead.</p>
        </Card>

        <Card eyebrow="Robots" title="AI crawlers" id="ai-bots">
          <div className="sec-kv first">
            <div>
              <p className="sec-row-title"><span>Training crawlers</span></p>
              <p className="sec-p small">{data.crawlers.trainingSample.join(', ')} and {data.crawlers.training - data.crawlers.trainingSample.length} more are always told no in robots.txt, and the site refuses them too: a request that names one in its user agent gets a 403 (robots.txt, /.well-known/, the AI policy and the Terms excepted). It&rsquo;s the promise on the AI policy page, so it has no switch.</p>
            </div>
            <Chip tone="ok">Always blocked</Chip>
          </div>
          <SwitchRow
            field="blockAiSearch" title="Block AI answer engines" state={answer} busy={busy} error={errors.blockAiSearch} onFlip={flip}
          >
            <p className="sec-p">On: robots.txt tells {data.crawlers.answerSample.join(', ')} and {data.crawlers.answer - data.crawlers.answerSample.length} more not to read pages to answer questions about the site, and the site answers them 403 as it does the training crawlers. Off: robots.txt stops naming them, the site lets them in and the AI policy page says so, but every page&rsquo;s headers still ask AI not to use it and the Terms still forbid it, so check with the lawyer before turning it off. The training crawlers stay blocked either way.</p>
          </SwitchRow>
          <p className="sec-p small">The refusal goes by the name a crawler gives. It stops the ones that say who they are, including those that ignore robots.txt; one dressed up as a browser gets through, and files served straight from the build (scripts, images) never reach this check. Vercel&rsquo;s firewall covers the rest (Admin → Security, &ldquo;Done in other dashboards&rdquo;).</p>
          <p className="sec-p"><a href="/robots.txt" target="_blank" rel="noreferrer">See robots.txt ↗</a> · <a href={AI_POLICY_PATH} target="_blank" rel="noreferrer">AI policy ↗</a></p>
        </Card>

        <Card eyebrow="Creators’ work" title="Bring older uploads behind the locks" id="ai-work" wide>
          <p className="sec-p">New uploads are locked as they arrive. These bring in what was uploaded before; each is safe to run again.</p>
          <ProtectionRun
            title="Every video plays from a signed link"
            blurb="Titles, trailers, lessons, Snippets and self-tapes stop playing from a permanent address. Run it again if Cloudflare was unreachable during an approval."
            lastRun={runs.videos} label="Protect every video" busyLabel="Protecting…" url="/api/admin/sync-stream-protection"
            render={(result) => <VideosResult result={result} />}
          />
          <ProtectionRun
            title="Captions in private storage"
            blurb="A caption track is the whole script as text; only someone allowed to watch gets it. Moves the old ones and removes their public copies."
            lastRun={runs.captions} label="Move captions" busyLabel="Moving…" url="/api/admin/protect-media" body={{ what: 'captions' }}
            render={(result) => <CaptionsResult result={result} />}
          />
          <ProtectionRun
            title="Film University files locked"
            blurb="Makes the course-file bucket private. Readings and files keep working through one-hour links."
            lastRun={runs.university} label="Lock the files" busyLabel="Locking…" url="/api/admin/protect-media" body={{ what: 'university' }}
            render={(result) => <UniversityResult result={result} />}
          />
          <ProtectionRun
            title="Podcast audio locked"
            blurb="Makes the podcast audio bucket private. Nothing is copied: every play, every podcast-app download from a show's feed and the review queue's player already go through links that last a few hours, and the free episodes a public feed lists still open for anyone."
            lastRun={runs.podcasts} label="Lock podcast audio" busyLabel="Locking…" url="/api/admin/protect-media" body={{ what: 'podcasts' }}
            render={(result) => <PodcastsResult result={result} />}
          />
          <ProtectionRun
            title="Snippet photos and covers in private storage"
            blurb="Kept as a copy no wider than 1600px with the camera and location data stripped; the public copies are removed."
            lastRun={runs.posts} label="Move photos" busyLabel="Moving…" url="/api/admin/protect-media" body={{ what: 'posts' }}
            render={(result) => <PostsResult result={result} />}
          />
        </Card>

        <Card eyebrow="Signals" title="What every page says to AI companies" id="ai-signals">
          <p className="sec-p">Sent with every page and image; read-only here.</p>
          <div className="sec-signals">
            <code>X-Robots-Tag: noai, noimageai</code>
            <code>TDM-Reservation: 1</code>
            <code>Content-Usage: train-ai=n, ai-use=n</code>
            <code>Content-Signal: ai-train=no</code>
            <code>/.well-known/tdmrep.json</code>
          </div>
        </Card>

        <Card eyebrow="The seal" title="“Not for AI training”" id="ai-seal">
          <div className="sec-seal"><AiSealChip /></div>
          {data.seal ? (
            <p className="sec-p">{data.seal.creators - data.seal.off} of {data.seal.creators} creator{data.seal.creators === 1 ? '' : 's'} with released work show it on their titles and profile{data.seal.off ? `; ${data.seal.off} turned it off` : ''}. The policy covers everyone either way; the seal only decides whether the mark shows.</p>
          ) : <p className="sec-p">Couldn&rsquo;t count the creators just now.</p>}
        </Card>
      </div>
    </AdminShell>
  );
}
