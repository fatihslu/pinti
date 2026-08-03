# PythonAnywhere yayın notları

1. Projeyi `~/Pinti` klasörüne yükle veya Git ile klonla.
2. Bash konsolunda `python3 -m venv ~/.virtualenvs/pinti` ve ardından
   `source ~/.virtualenvs/pinti/bin/activate && pip install -r requirements.txt` çalıştır.
3. **Web** sekmesinden Flask tabanlı manuel uygulama oluştur, virtualenv olarak
   `~/.virtualenvs/pinti` seç.
4. WSGI dosyasını aşağıdaki gibi değiştir:

```python
import sys
path = '/home/KULLANICI_ADIN/Pinti'
if path not in sys.path:
    sys.path.insert(0, path)
from flask_app import app as application
```

5. Uygulamayı Reload et ve `/health` adresini aç.

Not: PythonAnywhere web worker içinde sürekli zamanlayıcı çalıştırılmaz. Saatlik
alarm işlemi, PythonAnywhere'in **Tasks** ekranındaki ayrı bir saatlik görevle
çalıştırılmalıdır; bu görev için `run_hourly.py` eklenmeden yayına geçilmez.
