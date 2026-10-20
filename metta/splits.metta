(role-share music 30)
(role-share lyrics 30)
(role-share melody 20)
(role-share arrangement 10)
(role-share production 10)

(= (role-points $r) (match &self (role-share $r $p) $p))

(= (points $roles)
   (if (== $roles ()) 0
     (+ (role-points (car-atom $roles)) (points (cdr-atom $roles)))))
