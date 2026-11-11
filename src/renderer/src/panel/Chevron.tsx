/**
 * The arrow of a panel's fold button, pointing the way the panel folds, and of its strip, pointing toward the board,
 * the way it opens.
 */
export default function Chevron(props: { points: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={props.points === 'right' ? 'M3.5 2 6.5 5l-3 3' : 'M6.5 2 3.5 5l3 3'} />
    </svg>
  );
}
