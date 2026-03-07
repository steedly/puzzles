export default function WinModal({ moveCount, minMoves, hasNext, onNext, onReplay }) {
  const optimal = minMoves > 0 && moveCount === minMoves;
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal__title">{optimal ? '★ Perfect!' : 'Solved!'}</h2>
        <p className="modal__body">
          Target reached the center in <strong>{moveCount}</strong> move{moveCount !== 1 ? 's' : ''}.
          {minMoves > 0 && !optimal && (
            <><br /><span className="modal__optimum">Optimal: {minMoves} move{minMoves !== 1 ? 's' : ''}</span></>
          )}
        </p>
        <div className="modal__actions">
          <button className="modal__btn modal__btn--secondary" onClick={onReplay}>
            Play Again
          </button>
          {hasNext && (
            <button className="modal__btn modal__btn--primary" onClick={onNext}>
              Next Puzzle →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
