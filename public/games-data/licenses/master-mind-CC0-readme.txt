==============================================================================
                           M A S T E R   M I N D
==============================================================================

The goal of this puzzle game is to crack the code consisting of four colored
pins by guessing combinations. For each guess, you get as feedback how many
pins you guessed the right color but the wrong position (white dots), and how
many pins you guessed the right color AND position (black dots).

You can then adjust your guess, and try again for more feedback. Be smart and
you may crack the code!



==============================================================================
                               R U N N I N G
==============================================================================

Master Mind is written in assembly for MS-DOS, because was the style in '99.
Luckily, it runs fine in DOSBox [https://www.dosbox.com/]!



==============================================================================
                               B U G   F I X
==============================================================================

Note from 2009-05-17:

For some reason, Master Mind would exit as soon as you moved the mouse in the
main menu, rendering the game unplayable. Apparantly, it read directly from the
keyboard I/O ports, and for some reason, this went wrong, making Master Mind
think the escape key was pressed.

I patched the Master Mind binary to not read from the keyboard ports anymore,
making the problem go away. This means Master Mind can not be quit by pressing
escape anymore, but it makes the game playable.

The bugged version is included as BUGGY.EXE.



==============================================================================
                             C O P Y R I G H T
==============================================================================

Master Mind was written by Marcel Moreaux in 1999.

Contrary to what's in the exit screen the program shows, I'm releasing this
under the public domain to the largest extent possible. In practice that means
it's licensed under CC0 [https://creativecommons.org/publicdomain/zero/1.0/].

Sadly, I lost the source code to Master Mind, so it's just the built program.
