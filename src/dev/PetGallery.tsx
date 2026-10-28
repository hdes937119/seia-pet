import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { ChibiPet } from '../components/pet/ChibiPet';
import { ALL_PET_STATES } from '../components/pet/petStates';

/** 開發用預覽頁：同時顯示所有運作模式與情緒動作，方便調整素材與特效 */
function PetGallery() {
  const [talking, setTalking] = useState(false);
  return (
    <div className="min-h-screen p-4 text-slate-100">
      <div className="flex items-center gap-3 mb-3">
        <h1 className="font-bold">雙子星貓 · 動作預覽</h1>
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={talking} onChange={(e) => setTalking(e.target.checked)} />
          說話中
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ALL_PET_STATES.map((s) => (
          <div
            key={s.id}
            className="h-72 rounded-2xl border border-indigo-500/40 bg-gradient-to-b from-[#131854] via-[#1d2268] to-[#261d5c] overflow-hidden pt-4"
          >
            <ChibiPet state={s.id} isTalking={talking} />
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<PetGallery />);
