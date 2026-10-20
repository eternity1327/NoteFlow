(= (feature-score $k $v)
   (let $r (collapse (match &self (pref $k $v $w) $w))
     (if (== $r ()) 0 (car-atom $r))))

(= (score $mood $progression $harmony $rhythm $tempo $structure $theme)
   (+ (feature-score mood $mood)
   (+ (feature-score progression $progression)
   (+ (feature-score harmony $harmony)
   (+ (feature-score rhythm $rhythm)
   (+ (feature-score tempo $tempo)
   (+ (feature-score structure $structure)
      (feature-score theme $theme))))))))

(= (stance $w)
   (if (>= $w 3) loves
     (if (> $w 0) likes
       (if (<= $w -3) avoids dislikes))))

(= (nudge $k $v $d)
   (let $old (feature-score $k $v)
     (let $_ (remove-atom &self (pref $k $v $old))
       (let $new (+ $old $d)
         (if (== $new 0) forgotten (add-atom &self (pref $k $v $new)))))))

(feedback-delta like 1)
(feedback-delta keep 2)
(feedback-delta dislike -1)

(= (rate $verdict)
   (let $d (match &self (feedback-delta $verdict $d) $d)
     (collapse (match &self (idea-has $k $v) (nudge $k $v $d)))))

(= (request $change)
   (let* (($a (collapse (match &self (change $change $k $v $d) (nudge $k $v $d))))
          ($b (collapse (match &self (change-current $change $k $d)
                 (match &self (idea-has $k $v) (nudge $k $v $d))))))
     ok))

(= (forget-all)
   (collapse (match &self (pref $k $v $w) (remove-atom &self (pref $k $v $w)))))

(= (forget-idea)
   (collapse (match &self (idea-has $k $v) (remove-atom &self (idea-has $k $v)))))

(= (setup $genre $mood $tempo)
   (let* (($a (forget-all))
          ($b (nudge mood $mood 2))
          ($c (nudge tempo $tempo 2))
          ($d (collapse (match &self (genre-hint $genre $k $v) (nudge $k $v 1))))
          ($e (collapse (match &self (mood-hint $mood $k $v) (nudge $k $v 1)))))
     ok))

(= (rules) (match &self (pref $k $v $w) (rule (stance $w) $k $v $w)))
