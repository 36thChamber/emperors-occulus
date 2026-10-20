import io
import json
from occulus.cog import CogEvaluation, PREFIX


def test_catalog_rejects_changed_sources_and_unapproved_destinations():
    key = 'predictions/caraya/Alouatta_caraya_rs_250m_anual_2015_2024_adequabilidade.tif'
    stale = key.replace('adequabilidade', 'incerteza')
    invalid = key.replace('rs_250m', 'poligono_30m')
    def entry(k):
        return dict(module='ste', source_key=k, source_bucket='ste-siapesq', bucket='ste-siapesq', key=PREFIX+'ste/'+k, source_etag='source', etag='cog', bytes=100, cog_valid=True, pixels_bitwise_equal=True, masks_equal=True, range_read_verified=True)
    files = [entry(key), entry(stale), {**entry(invalid), 'key': 'private/file.tif'}]
    class S3:
        def get_object(self, **kwargs):
            assert kwargs == dict(Bucket='ste-siapesq', Key=PREFIX+'pilot-manifest.json')
            return dict(Body=io.BytesIO(json.dumps(dict(status='validated',errors=[],files=files)).encode()))
    original = dict(items=[dict(key=k,etag='updated' if k==stale else 'source',bytes=200) for k in [key,stale,invalid]])
    result = CogEvaluation(S3()).catalog(original)
    assert result['items']==[dict(key=key,etag='cog',bytes=100,dataset='cog')]
    assert original['items'][0]['etag']=='source'
