// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import GoldMedal from './GoldMedal';

export default function WinModal({
  moveCount, slideCount, minMoves, minRawSlides, scoreMode, hideOptimal,
  hasNext, onNext, onReplay,
  stableId, isStarred, toggleStar, getComment, setComment,
}) {
  const isSlides = scoreMode === 'slides';
  const userCount = isSlides ? slideCount : moveCount;
  const target = isSlides ? minRawSlides : minMoves;
  const unit = isSlides ? 'slide' : 'move';
  const label = isSlides ? 'Minimum Slides' : 'Minimum Moves';
  const perfect = target > 0 && userCount === target;

  const starred = !!(stableId && isStarred && isStarred(stableId));
  const comment = stableId && getComment ? getComment(stableId) : '';

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal__title">
          {perfect ? (<><GoldMedal className="gold-medal--lg" /> Perfect!</>) : 'Solved!'}
        </h2>
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
        {stableId && toggleStar && (
          <div className="modal__star-row">
            <button
              className="modal__star-btn"
              onClick={() => toggleStar(stableId)}
              title={starred ? 'Unstar this puzzle' : 'Star this puzzle'}
            >{starred ? '★ Starred' : '☆ Star'}</button>
            {starred && setComment && (
              <textarea
                className="modal__comment"
                placeholder="Notes about this puzzle…"
                value={comment}
                onChange={e => setComment(stableId, e.target.value)}
                rows={2}
              />
            )}
          </div>
        )}
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
