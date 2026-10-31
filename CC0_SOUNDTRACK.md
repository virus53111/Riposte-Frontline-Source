# CC0 soundtrack — preview build

This branch prepares a replacement for the four **non-commercial Suno tracks** in Riposte: Frontline. It does not change gameplay. The original public evaluation site is **not connected to this branch**.

| Game cue | New source | Creator | License |
| --- | --- | --- | --- |
| Menu | [Prepare to fight](https://opengameart.org/content/prepare-to-fight) | Basil | CC0 |
| Victory | [Victory](https://opengameart.org/content/victory-6) | Musheran | CC0 |
| Defeat | [Icy Game Over](https://opengameart.org/content/icy-game-over) | Sudocolon | CC0 |
| Rank-up | [Victory Fanfare](https://opengameart.org/content/victory-fanfare) | ARoachIFoundOnMyPillow | CC0 |

License declaration for the tracks is on each original OpenGameArt page; [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The audio is downloaded and transcoded by `tools/cc0_soundtrack.py` during the preview build; no restricted original music is reused in its output.

## Rebuilding

A Linux machine with Python 3 and ffmpeg/ffprobe:

```sh
python3 tools/cc0_soundtrack.py
python3 build.py
cp dist/riposte-frontline.html dist/index.html
```

GitHub Actions builds a downloadable preview artifact from this branch automatically.

**Not a commercial-ready release.** Per upstream `NOTICE.md`, the game name/logo, Mixamo animations and hit sample have **separate license terms** and still need replacement or confirmation before public commercialization. Some CC-BY sounds require attribution. Keep the original MIT notices.
