# X Gallery

A Chrome/Brave extension that overlays a masonry gallery on your x.com home
timeline ("For you" and "Following"). Click a card to read the post and its
thread in a side panel, and like or repost from there.

It only reads what X already loads for you. It sends no requests of its own,
and likes and reposts happen by clicking X's own buttons.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open (or reload) x.com/home.

Chrome works the same way at `chrome://extensions`.

## Controls

- **Hide replies**, **Hide reposts**, **Media only**, **Following only**: toggle chips.
- **3 | 4 | 5**: number of columns.
- **Close (x)** hides the gallery; the pill brings it back.

Settings are kept in `chrome.storage.local`. Run the tests with `npm test`.
