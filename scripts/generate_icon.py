"""Render the project's vector emblem as Windows ICO, without external services."""
from pathlib import Path
from PIL import Image, ImageDraw

scale=4
im=Image.new('RGBA',(128*scale,128*scale),'#020904')
d=ImageDraw.Draw(im)
def polygon(points,fill):d.polygon([(x*scale,y*scale) for x,y in points],fill=fill)
green='#71ff9b';black='#020904'
polygon([(54,10),(74,10),(74,29),(99,29),(99,37),(74,37),(74,46),(111,46),(111,59),(74,59),(74,90),(88,90),(88,98),(74,98),(74,118),(54,118),(54,98),(40,98),(40,90),(54,90),(54,59),(17,59),(17,46),(54,46),(54,37),(29,37),(29,29),(54,29)],green)
d.ellipse((37*scale,33*scale,91*scale,82*scale),fill=black)
d.ellipse((41*scale,37*scale,87*scale,79*scale),fill=green)
d.rectangle((49*scale,71*scale,79*scale,92*scale),fill=black)
d.rectangle((52*scale,71*scale,76*scale,89*scale),fill=green)
polygon([(47,55),(53,52),(61,55),(58,65),(48,65)],black)
polygon([(81,55),(75,52),(67,55),(70,65),(80,65)],black)
polygon([(64,65),(59,74),(69,74)],black)
for x in (55,63,71):d.rectangle((x*scale,79*scale,(x+2)*scale,89*scale),fill=black)
im.save(Path(__file__).resolve().parents[1]/'occulus/static/icon.ico',sizes=[(16,16),(32,32),(48,48),(128,128),(256,256)])
