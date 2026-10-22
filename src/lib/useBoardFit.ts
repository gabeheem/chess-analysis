import { useLayoutEffect, useRef } from 'react';

/** Fit the whole board below its opening heading using the actual layout,
 * rather than a fixed size or an estimated header-height subtraction. */
export function useBoardFit(workspace: unknown = 'analysis') {
  const column = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = column.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const board = element.querySelector<HTMLElement>('.board-frame');
      const wrapper = element.querySelector<HTMLElement>('.board-with-eval');
      if (!board || !wrapper) return;
      const boardTop = board.getBoundingClientRect().top + window.scrollY;
      const gutter = wrapper.getBoundingClientRect().width - board.getBoundingClientRect().width;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const size = Math.max(120, Math.floor(height - boardTop - 12));
      const value = `${Math.floor(size + gutter)}px`;
      if (element.style.getPropertyValue('--board-fit-width') !== value)
        element.style.setProperty('--board-fit-width', value);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    const header = document.querySelector('.app-header');
    if (header) observer.observe(header);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [workspace]);
  return column;
}
