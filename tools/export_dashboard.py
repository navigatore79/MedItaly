"""Export static dashboard assets; never publish service code or local configuration."""
from pathlib import Path
import shutil

root=Path(__file__).resolve().parents[1]
target=root/'public-dashboard'
if target.exists():shutil.rmtree(target)
target.mkdir()
allowed={'.html','.js','.css','.svg','.png','.jpg','.jpeg','.webmanifest','.wav','.json'}
for source in root.iterdir():
    if source.is_file() and source.suffix in allowed and source.name!='vercel.json':
        shutil.copy2(source,target/source.name)
print('Static dashboard exported.')
