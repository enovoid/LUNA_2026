// 세그먼트 컨트롤(디자인 시스템 SegmentedControl, radiogroup 패턴). 선택값을 URL 쿼리(?position=, ?year=)에 남긴다.
// 카드는 Astro가 정적으로 그려 두고, 이 섬은 보이기·숨기기만 바꾼다(카드를 다시 그리지 않음).
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ALL, applyFilter, readParam, writeParam } from '../lib/filter-dom';

interface Props {
  label: string;
  param: string;
  options: string[];
  /** 결과 수 안내 문구의 단위. 예) "명", "개" */
  unit: string;
}

export default function FilterControl({ label, param, options, unit }: Props) {
  const all = [ALL, ...options];
  const [value, setValue] = useState(ALL);
  const [status, setStatus] = useState('');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const mounted = useRef(false);

  // 첫 렌더는 서버 HTML과 같게(전체) 두고, 마운트 뒤 URL 값을 읽는다(하이드레이션 불일치 방지).
  useEffect(() => {
    setValue(readParam(param, options));
    const onPop = () => setValue(readParam(param, options));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [param, options]);

  useEffect(() => {
    const shown = applyFilter(param, value);
    if (mounted.current) {
      writeParam(param, value);
      setStatus(`${value === ALL ? '전체' : value} ${shown}${unit}`);
    }
    mounted.current = true;
  }, [param, value, unit]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const edge = { Home: 0, End: all.length - 1 }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const next = edge ?? (index + (step ?? 0) + all.length) % all.length;
    setValue(all[next] ?? ALL);
    refs.current[next]?.focus();
  };

  return (
    <div className="segmented-wrap">
      <div role="radiogroup" aria-label={label} className="segmented">
        {all.map((option, i) => {
          const selected = option === value;
          return (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className="segment"
              onClick={() => setValue(option)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {option}
            </button>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
