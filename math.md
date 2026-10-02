# Math

heres how the star positions should be calculated:

## Parameters

- $A$: between 0 and 1, 0.7 by default.
- $B$: between 0 and 1, 0.5 by default.
- $N$: between 1 and 25, 8 by default.
- $C$: in between 0 and 1, 0.5 by default. When using the variable in equations, always multiply by $\frac{N\arctan\left(\frac{1}{B}\right)}{\pi}$
- $C_{t}$: in between -10 and 10, -2.7 by default.
- $p$: the number of stars, always equal to 40.
- $d$: in between -5 and 5, 0.7 by default.

## Calculations

The following are exported from a desmos graph. When writing the equivalent code for each operation, add a comment with the latex equation so it can be determined what each function/block corresponds to.

- $G_{N}=\operatorname{normaldist}\left(0,d\right)$
- $G_{g}=G_{N}.\operatorname{random}\left(p\right)$
- $a_{dj}=\left\{\frac{i}{p}<\frac{C_{t}}{C}:1,1-\frac{\left(\frac{i}{p}C-C_{t}\right)}{C-C_{t}}\right\}$
- $r_{g1}=\frac{A+G_{g}\cdot a_{dj}}{\log\left(B\cdot\tan\left(\frac{\frac{i}{p}2\pi C}{2N}\right)\right)}$
- $\left(r_{g1}\cos\left(\frac{i}{p}2\pi C-\frac{T}{\left|r_{g1}\right|}\right),r_{g1}\sin\left(\frac{i}{p}2\pi C-\frac{T}{\left|r_{g1}\right|}\right)\right)$
- $r_{g2}=\frac{-A+G_{g}\cdot a_{dj}}{\log\left(B\cdot\tan\left(\frac{\frac{i}{p}2\pi C}{2N}\right)\right)}$
- $\left(r_{g2}\cos\left(\frac{i}{p}2\pi C-\frac{T}{\left|r_{g1}\right|}\right),r_{g2}\sin\left(\frac{i}{p}2\pi C-\frac{T}{\left|r_{g1}\right|}\right)\right)$
- $T=0$: this should be constant

# Reference

See https://www.desmos.com/calculator/44mr6owuye for the original galaxy, based on a paper at https://arxiv.org/pdf/0908.0892.pdf
