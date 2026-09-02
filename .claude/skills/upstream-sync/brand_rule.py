"""The one place the rebrand is defined.

Every tool that turns upstream's spelling into this fork's imports from here:
rebrand-merge.py at conflict time, sweep-brand.py after the picks, and the
verify step that checks nothing slipped through. Before this module existed
there were two copies with different rules — the conflict-time one renamed
blindly, with no notion of what must stay "orca", and it is where
"GNOME Manta screen reader" and the bundle id "com.stablyai.manta" came from.

Two rules, in this order:

1. IDENTITY — values that are not a word swap. Upstream's bundle id becomes
   this fork's, not a token-substituted cousin; upstream's domain becomes ours.
   These are exact strings, verified against upstream's tree.

2. EVIDENCE — a brand-bearing token is renamed only if the tree already
   contains its Manta form as a whole word. That keeps the deliberate remnants
   (upstream's repo slug, GNOME Orca, the skill aliases) without enumerating
   most of them, because none of them has a Manta twin. Everything declined is
   returned so the caller can print it: that list is where the next human
   decision lives.
"""
import functools
import re
import subprocess

# Verified against upstream/main on 2026-09-02: 47 hits for com.stablyai.orca,
# 142 for onorca.dev. An earlier copy mapped `ai.stably.orca`, which upstream
# never used, so the bundle id always fell through to the blind pass.
IDENTITY = (
    ('com.stablyai.orca', 'cn.sh.manta'),
    ('onorca.dev', 'manta.sh.cn'),
)

# Deliberate remnants that DO have a Manta twin, so the evidence rule alone
# would rename them. Each is load-bearing exactly as spelled:
#   - upstream's repo slug guards workflows this fork must never run
#   - the skill aliases keep already-installed skills resolvable
#   - onorca-cloud is upstream's hosted product, not a thing we ship
KEEP = frozenset({
    # The screen reader's binary — as a whole token. `/usr/bin/orca-ide` is
    # upstream's CLI and has a manta-ide twin, so it must NOT be caught here.
    '/usr/bin/orca',
    'stablyai/orca',
    'github.com/stablyai/orca',
    'orca-cli',
    'orca-emulator',
    'orca-emulator-android',
    'orca-linear',
    'orca-per-workspace-env',
    'orca-hourly-release',
    'onorca-cloud',
})
KEEP_SUBSTRING = (
    'stablyai/orca',
    'onorca-cloud',
    # Upstream's App Store listing. The id is theirs; a manta-ide/<their id> URL
    # is a lie, and this fork ships through TestFlight. Where it should point is
    # a product decision, not a rename.
    'apps.apple.com/app/orca-ide',
)
# Files that are ABOUT upstream, or where "Orca" is not the product at all.
# The evidence rule sees a Manta twin and would rewrite them into nonsense.
KEEP_PATH = (
    'README.md',                        # "a fork of Orca" is attribution
    'docs/readme/README.zh-CN.md',
    'docs/release-notes/',              # history says what it said
    'config/scripts/react-doctor-upstream-line-attribution.mjs',  # detects upstream code by its spelling
    'src/shared/marine-creature-names-primary.ts',                # the whale
    '.claude/skills/upstream-sync/',    # this skill's prose is about upstream
)
# Phrases where the brand is a bare word with a space in front of it, so the
# token scanner never sees them as one unit. GNOME Orca is Ubuntu's screen
# reader and the whole reason the Linux binary is manta-ide; renaming it in a
# comment turns the explanation into its own contradiction.
KEEP_PHRASE = ('GNOME Orca',)

TOKEN = re.compile(r'[A-Za-z0-9_.@/-]*(?:[Oo]rca|ORCA)[A-Za-z0-9_.@/-]*')


def rebrand_token(tok: str) -> str:
    return tok.replace('ORCA', 'MANTA').replace('Orca', 'Manta').replace('orca', 'manta')


@functools.lru_cache(maxsize=None)
def manta_twin_exists(token: str, ref: str = 'HEAD') -> bool:
    """Does the tree at `ref` already speak the Manta form of this token, as a word?

    Whole-word, not substring: `mantad` turns up inside unrelated identifiers,
    and a substring hit is not evidence that the fork uses that name.
    """
    if token in KEEP or any(k in token for k in KEEP_SUBSTRING):
        return False
    twin = rebrand_token(token)
    if twin == token:
        return False
    # The token often carries a path prefix (`../runtime/orca-runtime-browser`)
    # that no import in this tree spells the same way. The basename is what
    # identifies the module, so ask about that too.
    for candidate in (twin, twin.rsplit('/', 1)[-1]):
        # `-e`: a token that starts with `-` (`--orca-cli`, a CSS `--orca-*` variable)
        # is otherwise parsed as an option, exits 129, and is never renamed.
        hit = subprocess.run(['git', 'grep', '-q', '-w', '-F', '-e', candidate, ref], capture_output=True)
        if hit.returncode == 0:
            return True
    return False


def keep_whole_file(path: str) -> bool:
    return any(path == k or path.startswith(k) for k in KEEP_PATH)


WORD_CORE = re.compile(r'^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$')


def word_core(s: str) -> str:
    """What `git grep -w -F` effectively tests: the token with the non-word
    characters at either end stripped, so `../manta-x` and `manta-x` are the
    same evidence."""
    return WORD_CORE.sub('', s)


_SEG = re.compile(r'([-_./]|(?<=[a-z0-9])(?=[A-Z]))')


def _prefixes(word: str):
    """Every prefix that ends on a segment boundary: separators and CamelCase."""
    acc, out = '', []
    for part in _SEG.split(word):
        if not part:
            continue
        acc += part
        if part not in ('-', '_', '.', '/'):
            out.append(acc)
    return out


_EXT = re.compile(r'\.(ts|tsx|js|mjs|cjs|json|jsonc|md|mdx|yml|yaml|png|jpg|gif|svg|txt|sh|py|vbs|cmd|ps1|plist|rb|toml|lock|html|css)$')


def _no_family(twin: str) -> bool:
    core = word_core(twin)
    if core.endswith(('-', '_')) or twin.endswith(('-', '_')):
        return True
    if twin.startswith(('/tmp/', '/private/tmp/', '/var/folders/')):
        return True
    return '.' in core and '/' not in core and not _EXT.search(core)


def _qualified_family(prefix: str) -> bool:
    """Brand word plus at least one more segment after it."""
    m = re.search(r'[Mm]anta', prefix)
    return bool(m) and len(prefix) - m.end() >= 2


class Evidence:
    """The fork's vocabulary, read once, so a whole history can be transformed
    without a `git grep` per token.

    `twins` is every Manta-form candidate that exists in `ref` as a whole word.
    Found with one ripgrep pass over a checkout of `ref`: `git grep -f` with
    thousands of `-w` patterns is superlinear (500 patterns took 83s), and
    ripgrep's alternation is leftmost-first, so patterns go in longest-first or
    a short one shadows every longer one that starts with it. Verified against
    the per-token `git grep -w -F` on 300 files: identical decisions.
    """

    def __init__(self, ref: str, tokens, families: bool = True):
        self.ref = ref
        # Families are for transforming upstream's code wholesale (the mirror),
        # where both sides of every reference move together. On the fork's own
        # tree a family match can split a decision the fork made on purpose.
        self.use_families = families
        cands = set()
        for tok in tokens:
            core = tok.rstrip('.,')
            for q in ([core] + (core.split('__') if '__' in core else [])):
                if not q or q in KEEP or any(k in q for k in KEEP_SUBSTRING):
                    continue
                tw = rebrand_token(q if q == core else f'__{q}__')
                if tw != q:
                    for c in (tw, tw.rsplit('/', 1)[-1]):
                        c = word_core(c)
                        if c:
                            cands.add(c)
        import tempfile, os, shutil
        tmp = tempfile.mkdtemp(prefix='brand-evidence-')
        tree = os.path.join(tmp, 'tree')
        pat = os.path.join(tmp, 'patterns')
        try:
            subprocess.run(['git', 'worktree', 'add', '-q', '--detach', tree, ref], check=True, capture_output=True)
            with open(pat, 'w') as f:
                f.write('\n'.join(sorted(cands, key=lambda s: (-len(s), s))) + '\n')
            out = subprocess.run(['rg', '-F', '-w', '-o', '--no-filename', '--no-line-number', '-f', pat, '.'],
                                 capture_output=True, text=True, cwd=tree).stdout
            self.twins = set(line for line in out.splitlines() if line)
            # Every Manta-bearing word the fork uses, for the family rule below.
            vocab = subprocess.run(['rg', '-o', '-I', '--no-filename', '--no-line-number',
                                    r'[A-Za-z0-9_./-]*[Mm]anta[A-Za-z0-9_./-]*', '.'],
                                   capture_output=True, text=True, cwd=tree).stdout
            files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', ref],
                                   capture_output=True, text=True).stdout.splitlines()
            self.families = set()
            for w in set(vocab.split()) | {f for f in files if 'manta' in f.lower()}:
                for pre in _prefixes(word_core(w)):
                    if _qualified_family(pre):
                        self.families.add(pre)
        finally:
            subprocess.run(['git', 'worktree', 'remove', '--force', tree], capture_output=True)
            shutil.rmtree(tmp, ignore_errors=True)
        self.paths = set(files)
        self.dirs = set()
        for path in files:
            parts = path.split('/')
            for i in range(1, len(parts)):
                self.dirs.add('/'.join(parts[:i]))

    def twin_exists(self, token: str) -> bool:
        if token in KEEP or any(k in token for k in KEEP_SUBSTRING):
            return False
        twin = rebrand_token(token)
        if twin == token:
            return False
        if word_core(twin) in self.twins or word_core(twin.rsplit('/', 1)[-1]) in self.twins:
            return True
        return self.in_family(twin)

    def in_family(self, twin: str) -> bool:
        """Second tier of evidence: the fork renamed this *family*.

        Never for three shapes, where a family match is not a decision:
          - a dotted key with no file extension (`orca.host.appEnvironment`,
            `orca.mobile.connection-log.v1`): a storage or registry slot, and
            renaming one strands data — that is a migration, not a sync;
          - a token ending in `-` or `_`: a mkdtemp/label prefix in a fixture;
          - a temp path (`/tmp/orca-…`): fixture noise, kept as upstream wrote it.

        `orca-runtime-bind-pty-incarnation-handle` is new upstream; the fork has
        no such file yet, but it has forty `manta-runtime-*` files, so the name
        is decided. A family is a prefix that carries the brand plus at least
        one more segment — `manta-runtime`, `MantaRuntime`, `MANTA_E2E` — never
        the bare word, which would prove nothing. Measured on a replayed sync:
        42% of the tokens the direct rule declined, at 100% precision on a
        sample; the rest are fixture strings that should stay as upstream wrote
        them.
        """
        if not self.use_families or _no_family(twin):
            return False
        for pre in sorted(_prefixes(word_core(twin)), key=len, reverse=True):
            if _qualified_family(pre) and (pre in self.families or pre.rsplit('/', 1)[-1] in self.families):
                return True
        return False

    def path_twin(self, path: str) -> str:
        if 'orca' not in path.lower():
            return path
        twin = rebrand_token(path)
        if twin in self.paths:
            return twin
        parent = twin.rsplit('/', 1)[0] if '/' in twin else ''
        if parent and parent in self.dirs:
            return twin
        return path


def rebrand_text(text: str, ref: str = 'HEAD', evidence: 'Evidence | None' = None):
    """Return (new_text, renamed_tokens, declined_tokens)."""
    exists = evidence.twin_exists if evidence else (lambda tok: manta_twin_exists(tok, ref))
    for upstream, ours in IDENTITY:
        text = text.replace(upstream, ours)
    renamed, declined = set(), set()

    def replace(m):
        whole = m.group(0)
        # The scanner's character class includes `.`, so a token at the end of a
        # sentence arrives with its full stop and misses the KEEP entry for the
        # bare form. Decide on the core; put the punctuation back untouched.
        tok = whole.rstrip('.,')
        tail = whole[len(tok):]
        if not tok:
            return whole
        # A sentence that names GNOME Orca is about the screen reader, and the
        # bare `orca` package name usually sits a clause away from it.
        if any(ph in text[max(0, m.start() - 40):m.end() + 40] for ph in KEEP_PHRASE):
            declined.add(tok)
            return whole
        if exists(tok):
            renamed.add(tok)
            return rebrand_token(tok) + tail
        # Two brand-bearing names can sit flush against each other —
        # `__ORCA_AGENT_PATH__orca-fake-cli` is a sentinel this fork renamed
        # glued to a fixture name it did not. Judge the halves separately.
        if '__' in tok:
            parts = tok.split('__')
            if any(exists(f'__{q}__') for q in parts if q):
                out = '__'.join(
                    rebrand_token(q) if exists(f'__{q}__') else q for q in parts)
                if out != tok:
                    renamed.add(tok)
                    return out + tail
        declined.add(tok)
        return whole

    new = TOKEN.sub(replace, text)
    # Upstream writes "an Orca"; the rename leaves the article behind.
    new = re.sub(r'\ban Manta\b', 'a Manta', new)
    new = re.sub(r'\bAn Manta\b', 'A Manta', new)
    return new, renamed, declined


def rebrand_path(path: str, ref: str = 'HEAD') -> str:
    """Rename a file path only if the fork already carries the Manta-named file
    (or a sibling under the Manta-named directory). A path with no twin is one
    this fork never renamed, and moving it would orphan every import of it."""
    if 'orca' not in path.lower():
        return path
    twin = rebrand_token(path)
    if subprocess.run(['git', 'cat-file', '-e', f'{ref}:{twin}'], capture_output=True).returncode == 0:
        return twin
    parent = twin.rsplit('/', 1)[0] if '/' in twin else ''
    if parent and subprocess.run(['git', 'ls-tree', '-d', f'{ref}:{parent}'], capture_output=True).returncode == 0:
        return twin
    return path
