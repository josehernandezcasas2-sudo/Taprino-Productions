export default function WishlistButton({ isActive, onToggle, className }) {
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
      {isActive ? '♥' : '♡'}
    </button>
  );
}
