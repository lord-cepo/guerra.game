mv ~/Downloads/"$(ls -tr ~/Downloads | tail -n 1)" high_resolution/$1
convert high_resolution/$1 -resize 300x200 $1
