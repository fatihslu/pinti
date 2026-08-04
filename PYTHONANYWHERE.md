# PythonAnywhere yayın notları

1. Projeyi `~/pinti` klasörüne Git ile klonla.
2. Bash konsolunda `python3 -m venv ~/.virtualenvs/pinti` ve ardından
   `source ~/.virtualenvs/pinti/bin/activate && pip install -r requirements.txt` çalıştır.
3. **Web** sekmesinden Flask tabanlı manuel uygulama oluştur, virtualenv olarak
   `~/.virtualenvs/pinti` seç. **Source code** alanına da `/home/KULLANICI_ADIN/pinti` yaz.
4. WSGI dosyasını aşağıdaki gibi değiştir:

```python
import os
import sys

os.environ['PINTI_USERNAME'] = 'yonetici-kullanici-adi'
os.environ['PINTI_PASSWORD'] = 'guclu-bir-sifre'
os.environ['PINTI_SECRET_KEY'] = 'uzun-rastgele-bir-gizli-deger'
path = '/home/KULLANICI_ADIN/pinti'
if path not in sys.path:
    sys.path.insert(0, path)
from flask_app import app as application
```

5. Uygulamayı Reload et ve `/health` adresini aç.

Not: PythonAnywhere web worker içinde sürekli zamanlayıcı çalıştırılmaz. **Tasks**
ekranında aşağıdaki komutla saatlik bir görev oluştur:

```bash
cd /home/fatihslu/pinti && /home/fatihslu/.virtualenvs/pinti-env/bin/python run_hourly.py
```

Bu görev, düşük fiyat sayfasındaki kategorileri ve ürünleri kaydeder. Amazon bir
doğrulama/CAPTCHA sayfası döndürürse uygulama bunu aşmayı denemez; görev logunda
taramanın durduğu belirtilir.
