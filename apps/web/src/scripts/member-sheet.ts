// 멤버 타일을 누르면 시트(<dialog>)를 열고, 주소에 #member-… 를 남겨 링크로 공유할 수 있게 한다.
// 수상 페이지의 /members#member-… 링크로 들어오면 해당 시트를 바로 연다.
// 타일은 기수별·직군별 보기에 한 번씩 있어서 같은 시트를 두 타일이 연다(data-member-open = 시트 id).
const sheets = new Map<string, HTMLDialogElement>();
for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[data-member-sheet]')) {
  sheets.set(d.id, d);
}

function setHash(anchor: string) {
  const url = new URL(location.href);
  url.hash = anchor;
  history.replaceState(history.state, '', url);
}

function open(anchor: string) {
  const sheet = sheets.get(anchor);
  if (!sheet || sheet.open) return;
  sheet.showModal();
  setHash(anchor);
}

document.addEventListener('click', (e) => {
  const tile = (e.target as Element).closest<HTMLElement>('[data-member-open]');
  if (tile?.dataset.memberOpen) open(tile.dataset.memberOpen);
});

for (const [anchor, sheet] of sheets) {
  // 시트 바깥(배경)을 누르면 닫는다. 시트 내용이 dialog를 꽉 채우므로 target이 dialog면 배경이다.
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close();
  });
  sheet.addEventListener('close', () => {
    if (location.hash === `#${anchor}`) setHash('');
  });
}

const fromHash = () => open(decodeURIComponent(location.hash.slice(1)));
fromHash();
addEventListener('hashchange', fromHash);
