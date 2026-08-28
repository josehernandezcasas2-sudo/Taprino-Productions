import { HeartIcon, usePlayerIconOverrides } from './PlayerIcons';

export default function WishlistButton({ isActive, onToggle, className }) {
  const iconOverrides = usePlayerIconOverrides();
  return (
    <button
      type="button"
      className={`wishlist-btn ${isActive ? 'active' : ''} ${className || ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={isActive ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={isActive}
    >
      <HeartIcon active={isActive} src={isActive ? iconOverrides.heart_active : iconOverrides.heart_inactive} />
    </button>
  );
}
