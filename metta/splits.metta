(role music)
(role lyrics)
(role melody)
(role arrangement)
(role production)

(= (total $shares)
   (if (== $shares ()) 0
     (+ (car-atom $shares) (total (cdr-atom $shares)))))

(= (split-status $shares)
   (let $t (total $shares)
     (if (== $t 100) complete
       (if (< $t 100) under over))))
