export default function WinModal({ moveCount, slideCount, minMoves, minRawSlides, scoreMode, hideOptimal, hasNext, onNext, onReplay }) {
  const isSlides = scoreMode === 'slides';
  const userCount = isSlides ? slideCount : moveCount;
  const target = isSlides ? minRawSlides : minMoves;
  const unit = isSlides ? 'slide' : 'move';
  const label = isSlides ? 'Minimum Slides' : 'Minimum Moves';
  const perfect = target > 0 && userCount === target;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal__title">{perfect ? '★ Perfect!' : 'Solved!'}</h2>
        <p className="modal__body">
          Solved in <strong>{userCount}</strong> {unit}{userCount !== 1 ? 's' : ''}.
          {!perfect && hideOptimal && (
            <><br /><span className="modal__optimum">Can you find a shorter solution?</span></>
          )}
          {!perfect && !hideOptimal && target > 0 && (
            <><br /><span className="modal__optimum">{label}: {target}</span></>
          )}
          {perfect && hideOptimal && (
            <><br /><span className="modal__optimum">That's the minimum!</span></>
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
