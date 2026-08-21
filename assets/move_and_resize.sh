mv ~/Downloads/"$(ls -tr ~/Downloads | tail -n 1)" $1
convert $1 -resize 128x128 $1
