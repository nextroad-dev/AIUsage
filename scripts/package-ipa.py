"""Package an .app bundle into an .ipa with a predictable, tool-friendly layout.

    python3 scripts/package-ipa.py <path/to/App.app> <out.ipa>

Some sideloading and re-signing tools find the main bundle by scanning the archive's local
headers from the start and give up after a while, so `Payload/<App>.app/Info.plist` buried near
the end (where a plain `zip -r` tends to put it) reads as "no main bundle". This writes:

1. `Payload/` and `Payload/<App>.app/`
2. the main `Info.plist`, then the main executable (named by CFBundleExecutable)
3. everything else, directories before their contents, in sorted order

Entries carry Unix permissions and no platform-specific extra fields; symlinks are stored as links.
"""

import os
import plistlib
import stat
import sys
import zipfile


def add_dir(zf: zipfile.ZipFile, arcname: str, mode: int) -> None:
    info = zipfile.ZipInfo(arcname.rstrip('/') + '/')
    info.create_system = 3
    info.external_attr = (stat.S_IFDIR | (mode & 0o7777)) << 16 | 0x10
    zf.writestr(info, b'')


def add_path(zf: zipfile.ZipFile, path: str, arcname: str) -> None:
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode):
        info = zipfile.ZipInfo(arcname)
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(info, os.readlink(path))
        return
    info = zipfile.ZipInfo.from_file(path, arcname)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (st.st_mode & 0o7777)) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    with open(path, 'rb') as f:
        zf.writestr(info, f.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def main(app: str, out: str) -> None:
    app = os.path.abspath(app.rstrip('/'))
    name = os.path.basename(app)
    if not name.endswith('.app') or not os.path.isfile(os.path.join(app, 'Info.plist')):
        sys.exit(f'not an app bundle with an Info.plist: {app}')
    with open(os.path.join(app, 'Info.plist'), 'rb') as f:
        executable = plistlib.load(f).get('CFBundleExecutable')

    root = f'Payload/{name}'
    first = ['Info.plist'] + ([executable] if executable else [])
    written = set()

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, allowZip64=False) as zf:
        add_dir(zf, 'Payload/', 0o755)
        add_dir(zf, root, os.stat(app).st_mode)
        for rel in first:
            path = os.path.join(app, rel)
            if os.path.lexists(path):
                add_path(zf, path, f'{root}/{rel}')
                written.add(rel)
        for dirpath, dirnames, filenames in os.walk(app):
            dirnames.sort()
            rel_dir = os.path.relpath(dirpath, app)
            if rel_dir != '.':
                add_dir(zf, f'{root}/{rel_dir.replace(os.sep, "/")}', os.stat(dirpath).st_mode)
            for fn in sorted(filenames):
                rel = fn if rel_dir == '.' else f'{rel_dir}/{fn}'.replace(os.sep, '/')
                if rel in written:
                    continue
                add_path(zf, os.path.join(dirpath, fn), f'{root}/{rel}')
            # symlinked directories are walked as links, not followed
            for d in list(dirnames):
                full = os.path.join(dirpath, d)
                if os.path.islink(full):
                    rel = d if rel_dir == '.' else f'{rel_dir}/{d}'.replace(os.sep, '/')
                    add_path(zf, full, f'{root}/{rel}')
                    dirnames.remove(d)

    with zipfile.ZipFile(out) as zf:
        bad = zf.testzip()
        if bad:
            sys.exit(f'corrupt entry: {bad}')
        names = zf.namelist()
    print(f'{out}: {len(names)} entries; first: {names[:4]}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
