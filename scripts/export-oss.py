"""Export the reviewed committed source only; never change repository visibility."""
import hashlib,os,subprocess,sys,tempfile,zipfile
from pathlib import Path

root=Path(__file__).resolve().parent.parent
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
paths=subprocess.check_output(['git','ls-tree','-rz','--name-only',revision],cwd=root).decode().split('\0')
private=('.local/','.git/','textbook/','output/','node_modules/','.next/','.netlify/','test-results/','playwright-report/')
for name in filter(None,paths):
    is_env=any(part.startswith('.env') for part in Path(name).parts)
    if name.startswith(private) or (is_env and not name.endswith('.example')):
        raise SystemExit('Refusing a committed private path: '+name)
output=root/'.local/oss-release';output.mkdir(parents=True,exist_ok=True,mode=0o700)
archive=output/'linqs-source.zip'
fd,temporary=tempfile.mkstemp(suffix='.zip',dir=output);os.close(fd)
try:
    subprocess.run(['git','archive','--format=zip','--prefix=linqs/','-o',temporary,revision],cwd=root,check=True)
    subprocess.run([os.environ.get('GITLEAKS_BIN','gitleaks'),'dir',temporary,'--redact=100','--no-banner','--no-color','--max-archive-depth=3'],cwd=root,check=True)
    with zipfile.ZipFile(temporary) as z:
        assert all(name.startswith('linqs/') and '..' not in Path(name).parts for name in z.namelist())
        for required in ('LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','docs/PUBLIC_RELEASE.md','docs/dependency-licenses.json'):
            assert 'linqs/'+required in z.namelist(), 'Commit the reviewed preparation files before exporting'
    Path(temporary).chmod(0o600);Path(temporary).replace(archive)
finally:
    Path(temporary).unlink(missing_ok=True)
print('Source revision: '+revision)
print('Archive: '+str(archive))
print('SHA-256: '+hashlib.sha256(archive.read_bytes()).hexdigest())
