import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getAccountContext } from '../lib/accountContext';
import { getHomeFeedData } from '../lib/homeFeed';
import { countUnread } from '../lib/messages';
import HeaderNav from '../components/HeaderNav';
import MobileTabBar from '../components/MobileTabBar';
import Footer from '../components/Footer';
import HomeOnNow from '../components/HomeOnNow';
import TierChip from '../components/crew/TierChip';
import { Avatar } from '../components/crew/CrewBits';
import { FreeNowButton, FollowList, DeskMoney, DeskLink } from '../components/home/DeskBits';
import { avatarImgStyle } from '../lib/profileBanner';
import { getOwnCard } from '../lib/crewCards';
import { SITE } from '../lib/siteConfig';

// The Connect homepage: "The Notice Board" (2026-10-28, direction I of the
// signed-off canvas https://claude.ai/artifact/9ZffDNs2PYQupWg94qK9M2).
// The zine corkboard from the earlier home — tilted polaroids, cream
// cards, stickers — holds what the community pinned this week (lib/
// homeFeed.js), and a calm desk column beside it holds what is yours:
// your working card and the "I'm free right now" switch, what needs you,
// this month's money, your link, faces to follow, this week's counts and
// your course. Signed out, the desk is the invitation to pin yourself.
// Films, series and podcasts moved to Stream; the page points there once.
export async function getServerSideProps({ req, res }) {
  // Same signed-in-vs-anonymous split as stream.js/channel.js/etc. — this
  // is the most-visited page in the app and had no Cache-Control at all,
  // so every request (including every anonymous one that could safely
  // share a cached response) was hitting getServerSideProps fresh.
  const hasSession = Boolean(req.headers.cookie && /__session|__clerk/.test(req.headers.cookie));
  if (hasSession) {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  }
  res.setHeader('Vary', 'Cookie');

  const account = await getAccountContext(req);
  // The nearby rows are personal when the viewer has a place on their
  // working card; otherwise newest first.
  let near = null;
  if (account.isSignedIn) {
    try {
      const card = await getOwnCard(account.userId);
      if (card && card.place) near = { label: card.place.label, lat: card.place.lat, lng: card.place.lng };
    } catch (err) { /* no card */ }
  }
  const [feed, messagesUnread] = await Promise.all([
    getHomeFeedData({ userId: account.userId || null, near }),
    account.isSignedIn ? countUnread(account.userId).catch(() => 0) : Promise.resolve(0)
  ]);

  return {
    props: {
      isSignedIn: account.isSignedIn,
      isSubscriber: account.isSubscriber,
      email: account.email,
      isAdmin: account.isAdmin,
      isCreator: account.isCreator,
      messagesUnread,
      ...feed
    }
  };
}

function isExternalUrl(url) {
  return !!url && /^https?:\/\//i.test(url);
}

function dateLabel(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dollars(n) {
  return `$${Number(n).toLocaleString('en-US')}`;
}

// "9:12 AM" today, "yesterday", else "Oct 22".
function whenLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days < 1 && d.getDate() === now.getDate()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days < 2) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function todayLine(place) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
  return [today, place].filter(Boolean).join(' · ').toUpperCase();
}

export default function Home({
  isSignedIn, isSubscriber, email, isAdmin, isCreator, messagesUnread = 0, mainGenres,
  liveStream, announcements = [], featuredCreators = [], urgentCalls = [], castingCalls = [], newCalls = [],
  pitches = [], places = [], shooting = [], freeNow = [], course = null, deal = null,
  counts = {}, facesToFollow = [], crewNearLabel = null, desk = null
}) {
  const router = useRouter();
  const nearSuffix = crewNearLabel ? ' near you' : '';
  const hasBoard = urgentCalls.length || featuredCreators.length || pitches.length || castingCalls.length || shooting.length || places.length || announcements.length || freeNow.length || course || deal || newCalls.length;

  return (
    <>
      <Head>
        <title>{SITE.name}</title>
        <meta name="description" content={`${SITE.studio} — who needs a hand, what's raising money, where to shoot and who's free. Pinned by the people making things here.`} />
      </Head>

      <HeaderNav activeType="All" mainGenres={mainGenres} isSignedIn={isSignedIn} email={email} isAdmin={isAdmin} isCreator={isCreator} isSubscriber={isSubscriber} />

      <main id="main-content" className="hb-page">

        <div className="hb-masthead">
          <div>
            <div className="hb-kicker">{todayLine(crewNearLabel)}</div>
            <h1 className="hb-title">The Notice Board</h1>
          </div>
          <p className="hb-blurb">Who needs a hand, what's raising money, where to shoot and who's free. Pinned by the people making things here.</p>
        </div>

        {liveStream && (
          <div className="hb-gutter">
            <Link href="/live" className="hb-live">
              <span className="live-dot" aria-hidden="true" />
              <span className="hb-live-label">Live on TapaTV · CH 01</span>
              <span className="hb-live-title">{liveStream.title}</span>
              <span className="hb-live-cta">Tune in on Stream →</span>
            </Link>
          </div>
        )}

        <HomeOnNow />

        <div className="hb-layout">
          <div className="hb-main">
            {isSignedIn && (
              <div className="hb-since">
                <span>Since you last looked:</span>
                {counts.openCalls > 0 && <Link href="/crew/calls" className="hb-chip brass">{counts.openCalls} {counts.openCalls === 1 ? 'call' : 'calls'}{nearSuffix}{counts.urgent ? ` · ${counts.urgent} urgent` : ''}</Link>}
                {counts.freeNow > 0 && <Link href="/crew?free=1" className="hb-chip gold">{counts.freeNow} free right now</Link>}
                {messagesUnread > 0 && <Link href="/messages" className="hb-chip plain">{messagesUnread} unread {messagesUnread === 1 ? 'message' : 'messages'}</Link>}
                {desk && desk.unreadCount > 0 && <span className="hb-chip plain">{desk.unreadCount} {desk.unreadCount === 1 ? 'thing needs' : 'things need'} you</span>}
                {!(counts.openCalls || counts.freeNow || messagesUnread || (desk && desk.unreadCount)) && <span className="hb-chip plain">all quiet</span>}
              </div>
            )}

            {hasBoard ? (
              <section className="hb-board" aria-label="The board">
                {urgentCalls.map((c) => (
                  <article key={c.id} className="hb-pin paper tilt-l">
                    <span className="hb-tape" aria-hidden="true" />
                    <div className="hb-kick red">Urgent{c.neededLabel ? ` · ${c.neededLabel}` : ''}</div>
                    <h3>{c.title}</h3>
                    <p>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''} · {c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''} · {c.payLabel}{c.paySecured ? ' · Pay secured' : ''}</p>
                    <div className="hb-by">Posted by {c.posterName} {c.posterTier && <TierChip person={{ tier: c.posterTier, done: c.posterDone }} />}</div>
                    <div className="hb-pin-actions">
                      <Link href={`/crew/calls/${c.id}`} className="hb-btn dark">I can do it</Link>
                      <Link href={`/crew/calls/${c.id}`} className="hb-btn outline">See the call</Link>
                    </div>
                  </article>
                ))}

                {featuredCreators.length > 0 && (
                  <div className="hb-pin bare">
                    <div className="hb-kick sky">The faces behind it</div>
                    <div className="hb-polaroids">
                      {featuredCreators.map((c) => (
                        <Link key={c.userId} href={`/profile/${c.handle || c.userId}`} className="zine-polaroid">
                          <div className="zine-polaroid-photo">
                            {c.avatarUrl && <Image src={c.avatarUrl} alt="" fill sizes="120px" className="zine-fill-img" style={avatarImgStyle(c.avatarPosition, c.avatarZoom)} />}
                          </div>
                          <h5>{c.displayName}</h5>
                          <span className="zine-credit">{c.credits.slice(0, 2).join(', ')}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {pitches.map((p) => {
                  const pct = p.fundingGoal && p.fundingRaised != null ? Math.min(100, Math.round((p.fundingRaised / p.fundingGoal) * 100)) : null;
                  return (
                    <article key={p.id} className="hb-pin dark tilt-r">
                      <div className="hb-pin-band rust"><span>{p.title}</span></div>
                      <div className="hb-pin-body">
                        <div className="hb-kick gold">Pitch Room{p.creatorName ? ` · by ${p.creatorName}` : ''}</div>
                        {p.logline && <p className="hb-logline">{p.logline}</p>}
                        {pct != null && <div className="hb-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>}
                        {p.fundingRaised != null && <div className="hb-mono">{dollars(p.fundingRaised)} raised{p.fundingGoal ? ` of ${dollars(p.fundingGoal)}` : ''}</div>}
                        <div className="hb-pin-actions">
                          <Link href={`/pitches/${p.id}`} className="hb-btn gold">Back it</Link>
                          {p.creatorUserId && (
                            <span
                              className="hb-btn ghost"
                              role="link"
                              tabIndex={0}
                              onClick={(e) => { e.preventDefault(); router.push(`/profile/${p.creatorUserId}`); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/profile/${p.creatorUserId}`); } }}
                            >
                              The maker
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}

                {castingCalls.map((c) => (
                  <article key={c.id} className="hb-pin paper lined tilt-r">
                    <div className="hb-kick rust">Casting{c.projectTitle ? ` · ${c.projectTitle}` : ''}</div>
                    <h3>{c.characterName || c.title}{c.playingAge ? `, ${c.playingAge}` : ''}</h3>
                    <p>{c.role}{c.unionLabel ? ` · ${c.unionLabel}` : ''} · {c.payLabel}{c.selfTapeDue ? ` · self-tape due ${dateLabel(c.selfTapeDue)}` : ''}</p>
                    <Link href={`/crew/calls/${c.id}`} className="hb-link rust">{c.selfTapeDue ? 'Send a self-tape →' : 'See the role →'}</Link>
                  </article>
                ))}

                {shooting.map((p) => (
                  <article key={p.id} className="hb-pin outline tilt-r">
                    <div className="hb-kick sky"><span className="hb-pulse" aria-hidden="true" />Now shooting</div>
                    <h3>{p.title}</h3>
                    <p>{[p.membersCount ? `${p.membersCount} crew` : null, p.daysCount ? `${p.daysCount} ${p.daysCount === 1 ? 'day' : 'days'}` : null, p.placeLabel].filter(Boolean).join(' · ')}</p>
                    <div className="hb-pin-actions">
                      {p.openCalls > 0 && <Link href={`/crew/calls?production=${p.id}`} className="hb-chip brass">{p.openCalls} {p.openCalls === 1 ? 'spot' : 'spots'} still open</Link>}
                      <Link href={`/productions/${p.id}`} className="hb-link">See the production →</Link>
                    </div>
                  </article>
                ))}

                {places.map((l) => (
                  <Link key={l.id} href={`/locations/${l.id}`} className="hb-pin dark tilt-l">
                    <div className="hb-pin-photo">
                      {l.photo ? <Image src={l.photo} alt="" fill sizes="300px" className="zine-fill-img" /> : <span className="hb-pin-photo-empty">{l.kindLabel}</span>}
                    </div>
                    <div className="hb-pin-body">
                      <div className="hb-kick mint">Location{l.placeLabel ? ` · ${l.placeLabel}` : ''}{l.miles != null ? ` · ${l.miles} mi` : ''}</div>
                      <h3>{l.title}</h3>
                      <p>{[l.rateLine, l.studioRateLine, l.shootsCount ? `Hosted ${l.shootsCount}` : null, l.titlesShotHere ? `${l.titlesShotHere} ${l.titlesShotHere === 1 ? 'title' : 'titles'} shot here` : null].filter(Boolean).join(' · ')}</p>
                    </div>
                  </Link>
                ))}

                {announcements.map((a) => {
                  const external = isExternalUrl(a.linkUrl);
                  const Tag = a.linkUrl ? (external ? 'a' : Link) : 'div';
                  const tagProps = a.linkUrl ? (external ? { href: a.linkUrl, target: '_blank', rel: 'noopener noreferrer' } : { href: a.linkUrl }) : {};
                  return (
                    <Tag key={a.id} {...tagProps} className="hb-pin gold tilt-l">
                      <div className="hb-kick ink">From the studio · {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })}</div>
                      <h3>{a.title}</h3>
                      {a.body && <p>{a.body}</p>}
                    </Tag>
                  );
                })}

                {freeNow.length > 0 && (
                  <div className="hb-pin dark pad">
                    <div className="hb-kick gold">Free right now{nearSuffix}</div>
                    {freeNow.map((p) => (
                      <Link key={p.userId} href={p.profilePath} className="hb-row">
                        <Avatar userId={p.userId} name={p.displayName} src={p.avatarUrl} position={p.avatarPosition} zoom={p.avatarZoom} size="sm" />
                        <span className="hb-row-text"><b>{p.displayName}</b><small>{p.roles.join(' · ')}{p.miles != null ? ` · ${p.miles} mi` : ''}</small></span>
                        <span className="hb-row-end">{p.availableNowUntil ? `till ${new Date(p.availableNowUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'today'}</span>
                      </Link>
                    ))}
                    <Link href="/crew?free=1" className="hb-link">Everyone free now →</Link>
                  </div>
                )}

                {newCalls.map((c) => (
                  <Link key={c.id} href={`/crew/calls/${c.id}`} className="hb-pin paper tilt-r">
                    <div className="hb-kick rust">Crew call{c.projectTitle ? ` · ${c.projectTitle}` : ''}</div>
                    <h3>{c.title}</h3>
                    <p>{c.role}{c.spots > 1 ? ` · ${c.spots} spots` : ''} · {c.remote ? 'Remote' : c.place}{c.miles != null ? ` · ${c.miles} mi` : ''}{c.startsOn ? ` · ${dateLabel(c.startsOn)}` : ''}</p>
                    <div className="hb-by">by {c.posterName} {c.posterTier && <TierChip person={{ tier: c.posterTier, done: c.posterDone }} />}</div>
                    <div className="hb-mono rust">{c.payLabel}{c.paySecured ? ' · pay secured' : ''}{c.payNote ? ` · ${c.payNote}` : ''} · {c.responsesCount} {c.responsesCount === 1 ? 'response' : 'responses'}</div>
                  </Link>
                ))}

                {course && (
                  <Link href={course.lessonSlug ? `/university/${course.slug}/${course.lessonSlug}` : `/university/${course.slug}`} className="hb-pin paper tilt-r">
                    <div className="hb-kick green">Film University · {course.started ? 'class is in' : 'new course'}</div>
                    <h3>{course.title}</h3>
                    <p>{course.started ? `Lesson ${course.doneCount + 1} of ${course.total}${course.remaining ? ` · ${course.remaining} left` : ''}` : [course.levelLabel, course.total ? `${course.total} ${course.total === 1 ? 'lesson' : 'lessons'}` : null, 'free'].filter(Boolean).join(' · ')}</p>
                    <span className="hb-link green">{course.started ? `Pick up at ${course.lessonTitle} →` : 'Start the course →'}</span>
                  </Link>
                )}

                {deal && (
                  <Link href="/resources" className="hb-pin dashed">
                    <div className="hb-kick gold">Resources · partner deal</div>
                    <h3>{deal.deal}</h3>
                    <p>{deal.name}{deal.kindLabel ? ` · ${deal.kindLabel}` : ''}{deal.hasCode && !deal.canReveal && deal.gateLabel ? ` · the code opens for ${deal.gateLabel.toLowerCase()}` : ''}</p>
                    <span className="hb-link">{deal.hasCode ? 'Show the code →' : 'See the deal →'}</span>
                  </Link>
                )}
              </section>
            ) : (
              <section className="hb-board hb-board-empty">
                <p>Nothing is pinned yet. The first calls, pitches and places will show here.</p>
              </section>
            )}

            <section className="hb-stream" aria-label="Over on Stream">
              <div>
                <div className="hb-kick dim">Over on Stream</div>
                <p>Films, series and podcasts made by the people on this board.</p>
              </div>
              <Link href="/stream" className="hb-btn brass">Go to Stream</Link>
            </section>
          </div>

          {/* The desk is two grid areas so a phone can show the working
              card and what needs you above the board and the rest below it. */}
          {isSignedIn && desk && (
            <aside className="hb-desk hb-desk-top" aria-label="Your desk">
                <div className="hb-desk-label strong">Your desk</div>
                <div className="hb-desk-card">
                  <div className="hb-desk-who">
                    <Avatar userId={desk.userId} name={desk.displayName || 'You'} src={desk.avatarUrl} position={desk.avatarPosition} zoom={desk.avatarZoom} size="md" />
                    <div>
                      <b>{desk.displayName || 'Your working card'}</b>
                      {desk.card ? (
                        <span className="hb-desk-tier">{desk.card.tier && <TierChip person={{ tier: desk.card.tier, done: desk.card.done }} />}{desk.card.availability === 'open' ? <small>open to work</small> : null}</span>
                      ) : <small>No working card yet</small>}
                    </div>
                  </div>
                  {desk.card && (
                    <>
                      <p className="hb-desk-line">{desk.card.roles.join(' · ') || 'No roles yet'}</p>
                      <p className="hb-desk-sub">{[desk.card.placeLabel, desk.card.travelMiles ? `travels ${desk.card.travelMiles} mi` : null, desk.card.remoteOk ? 'remote OK' : null].filter(Boolean).join(' · ')}</p>
                    </>
                  )}
                  <FreeNowButton until={desk.card ? desk.card.availableNowUntil : null} hasCard={Boolean(desk.card)} />
                  <div className="hb-desk-links">
                    <Link href="/crew/card">{desk.card ? 'Edit your card →' : 'Why a card? →'}</Link>
                    <Link href="/crew/calls/new">Post a call</Link>
                  </div>
                </div>

                {desk.needs.length > 0 && (
                  <div className="hb-desk-card">
                    <div className="hb-desk-label brass">Needs you · {desk.unreadCount}</div>
                    {desk.needs.map((n) => (
                      <Link key={n.id} href={n.href || '/account'} className="hb-need">
                        <span className={`hb-need-dot type-${n.type}`} aria-hidden="true" />
                        <span className="hb-need-text">{n.message}</span>
                        <span className="hb-need-when">{whenLabel(n.createdAt)}</span>
                      </Link>
                    ))}
                  </div>
                )}

            </aside>
          )}

          <aside className="hb-desk hb-desk-rest" aria-label={isSignedIn && desk ? 'More from your desk' : 'Your desk'}>
            {isSignedIn && desk ? (
              <>
                {(isCreator || isAdmin) && <DeskMoney />}
                {(isCreator || isAdmin) && <DeskLink />}
              </>
            ) : (
              <div className="hb-desk-card gold tilt-l">
                <div className="hb-kick ink">Pin yourself to the board</div>
                <h2>Make a working card. Calls near you find you.</h2>
                <p>Your roles, your gear, how far you'll travel. Free, and it only takes a couple of minutes.</p>
                <div className="hb-pin-actions">
                  <Link href="/crew/card" className="hb-btn dark">Make my card</Link>
                  <Link href="/account" className="hb-btn outline">Sign in</Link>
                </div>
              </div>
            )}

            <FollowList people={facesToFollow} isSignedIn={isSignedIn} />

            <div className="hb-desk-card">
              <div className="hb-desk-label">This week{nearSuffix}</div>
              <Link href="/crew/calls" className="hb-week-row"><span>Open calls</span><b className="brass">{counts.openCalls || 0}</b></Link>
              <Link href="/pitches" className="hb-week-row"><span>Projects raising</span><b className="gold">{counts.raising || 0}</b></Link>
              <Link href="/locations" className="hb-week-row"><span>{counts.newPlaces ? 'New places' : 'Places to shoot'}</span><b className="mint">{counts.newPlaces || counts.places || 0}</b></Link>
              <Link href="/productions" className="hb-week-row"><span>Shooting</span><b className="sky">{counts.shooting || 0}</b></Link>
              <Link href="/crew?free=1" className="hb-week-row"><span>Free right now</span><b className="gold">{counts.freeNow || 0}</b></Link>
            </div>

            {isSignedIn && course && course.started && (
              <Link href={`/university/${course.slug}/${course.lessonSlug}`} className="hb-desk-card hb-desk-course">
                <div className="hb-desk-label mint">Your course</div>
                <b>{course.title}</b>
                <div className="hb-bar" aria-hidden="true"><span style={{ width: `${Math.round((course.doneCount / Math.max(1, course.total)) * 100)}%` }} /></div>
                <p className="hb-desk-foot">Lesson {course.doneCount + 1} of {course.total} · Continue</p>
              </Link>
            )}

            {!isSubscriber && (
              <Link href="/account" className="zine-classified hb-classified">
                <span className="zine-classified-eyebrow">Classifieds — Membership</span>
                <h4>WANTED: ad-free viewers to back the creators directly.</h4>
                <p>Early episodes, gated series, and a direct line to what you fund. Inquire within.</p>
                <span className="zine-classified-cta">Join {SITE.premiumTier} →</span>
              </Link>
            )}
          </aside>
        </div>
      </main>

      <MobileTabBar />
      <Footer />
    </>
  );
}
