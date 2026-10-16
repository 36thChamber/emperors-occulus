"""Bounded, read-only lookup of published occurrence CSVs for a raster species."""
import re
import time
import threading
from .modules import parse

MAX_BYTES = 16 * 1024 * 1024
ALIASES = {'Alouatta_caraya': 'caraya', 'Alouatta_guariba': 'guariba', 'Sapajus_nigritus': 'nigritus', 'Primatas_grupo': 'aranha'}


class OccurrenceReader:
    def __init__(self, s3):
        self.s3 = s3
        self.objects = []
        self.at = 0
        self.lock = threading.RLock()

    def read(self, module, key):
        parsed = parse(module, key)
        if not parsed or module not in ('ste', 'siapresp'):
            raise ValueError('Seleção de espécie inválida.')
        with self.lock:
            if not self.at or time.time() - self.at > 600:
                self.objects = [o for page in self.s3.get_paginator('list_objects_v2').paginate(Bucket='ste-siapesq', Prefix='species-table/') for o in page.get('Contents', [])]
                self.at = time.time()
            area = parsed['area']
            fixed = 'species-table/' + ALIASES.get(area, '') + '.csv'
            selected = next((o for o in self.objects if o['Key'] == fixed), None)
            if selected is None:
                pattern = re.compile(r'^species-table/Occurrence_' + re.escape(area) + r'_(\d{2})_(\d{2})_(\d{2})( \(\d+\))?\.csv$', re.I)
                matches = [(m[3] + m[2] + m[1], not bool(m[4]), o['Key'], o) for o in self.objects if (m := pattern.fullmatch(o['Key']))]
                selected = max(matches)[3] if matches else None
            if selected is None:
                return None
            if selected['Size'] > MAX_BYTES:
                raise ValueError('Tabela acima do limite de leitura de 16 MiB.')
            response = self.s3.get_object(Bucket='ste-siapesq', Key=selected['Key'], IfMatch=selected['ETag'])
            try:
                data = response['Body'].read(MAX_BYTES + 1)
            finally:
                response['Body'].close()
            if len(data) > MAX_BYTES:
                raise ValueError('Tabela acima do limite de leitura de 16 MiB.')
            return {'source': selected['Key'], 'etag': selected['ETag'], 'bytes': len(data), 'text': data.decode('utf-8-sig')}
