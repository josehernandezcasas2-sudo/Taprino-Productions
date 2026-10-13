import { avatarImgStyle } from '../lib/profileBanner';

// A person's photo inside a circle, at their saved focal point and zoom
// (user_profiles.avatar_position / avatar_zoom), so every avatar on the
// site crops the way the account page showed them. Wrap the circle in
// AvatarPhoto (or give your own wrapper the avatar-photo class and drop
// an AvatarImg in it). No measuring: cover at the focal point, scaled
// about that point — the same slice PositionedPhoto computes.
export function AvatarImg({ url, position, zoom }) {
  if (!url) return null;
  return <img src={url} alt="" draggable={false} className="avatar-photo-img" style={avatarImgStyle(position, zoom)} />;
}

export default function AvatarPhoto({ url, position, zoom, className = '', style, children }) {
  return (
    <span className={`avatar-photo ${className}`} style={style}>
      {url ? <AvatarImg url={url} position={position} zoom={zoom} /> : children}
    </span>
  );
}
