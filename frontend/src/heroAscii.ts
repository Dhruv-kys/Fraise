// Generated from the alpha + luminance of the cropped cutout
// (public/hero-atlas-cut.png). A FULL padded rectangle whose aspect matches the
// image, at a deliberately coarse 56 columns so each glyph is big and chunky.
// When it fills the reveal frame it maps 1:1 onto the photo — identical
// coverage, just rendered in large characters. Don't strip trailing spaces
// (that re-centers + shifts it off the photo). HERO_RAMP maps brightness to
// glyph density; the slow churn in AsciiField re-rolls each glyph within a step
// or two of its base so the figure stays legible while the text quietly lives.
export const HERO_ASPECT = 0.4817;
export const HERO_ORB_X = 49.68;
export const HERO_ORB_Y = 23.93;
export const HERO_ORB_W = 90.51;
export const HERO_RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const HERO_ASCII_RAW = `
                                                        
                      i!!i!i~ii!!lll                    
                 i~+~++~~~~ii!llIIII;IIIl               
              __+?-_-_+_+iii!!lII;::;::;;II!            
           ][}}]]?--___~iii!!lI;;;;::,::::;IIl          
         rnvxr|1{?]-_~++i!!!III;;::::::::::::;;l        
       (|xvUQUcx({[?+_+~ii!lII;;:::::,,,:::,::;;I~      
      1}(txvzJCJuf)]-_+~i!!lll;;;:,,::,:::,,::::;I+     
     _]}1)()(xcUCUn|}?+il;::::::::,,:,:::,,,::,::::!    
    ~]?][][]]?[/fvUU)l::l])tf/)]I::,:,:,,,:,:,,,,:::!   
   ++i__++__-+-??}{~I~)zZmwwmmwwZX(;,,:,:,,,",,,,,,,:   
   lii!!!i~!i~i~~+::_QmmwwqwwwwmwmmJ!,,:,,,,,,,,,,,,,I  
   llIIIIIIIIIlll;:!QwqwwmmwmwwmwwmmX:,,,,,,",,,,,",,;  
  ~I;::;::::,:::;,,]mwqwwwmU[XmmmmZZZI:,,,,,",,",,,,,;  
  !;:::;::,:,::::,,imwwwmwwZmmwwZZZOJ,,:::,:,,",,,,,:;  
   II;;;;:::,::::,,:tmwwwwwwwmwmmmmO-,,::::::,:,,::,:I  
   lII;;;:::::,::::,,[YmwwmwmmwmmZv+:;!lII;;:::::::::   
   1)-/I+::;:::::,:,,,:!1rXYUYcf[l,;}t{-+i!lI;;;;;i!i   
    xrr|~:::::::,,:,,:,,,,::::,,::Ii?)uv/{-+i!Ili+{[{   
     cuv|l,,,,::,:::,,,,,,,,,,,::,;I!+](xcj(+_+i!j}1|   
      uUt],,::,::,::,:,,",,,:,,:,:;;I!++-|czr)[_cf{}    
      Q0(+:,,,,:,:::,,,,,,,,,,,:,:::;;Ii~_]fnur(r[1     
      mx1}II;:,,:,::,,,",,,,,,,,,,::::;I!i~[]{}/}?      
    wdQr)1   I;:::::,,,,,,:I++~~l!,,::;;;Il+  cz}|      
    Zwz|1}     l;;:::,:::!{{)]_+i!!l:::;II   ZQf}(      
    mzx{{}1|        :;:!?}1(}--llIIIiI      mwn{1/      
    r[|1111(||(/Xuj    j?]}?)}?ii;l!_    cvLOz1{1       
      (1111{11{}[||11(nLcffxrn)]+~++{xCYvf1r//{{        
        f{))11{1}]|1}-?/0/[f/]{}]+i_+}{}}{11{[{         
          (/|(]-_-((}[}]}{][[?f-!!l!_][}{{{{            
              X|[_1)){[}[_~!il;~+_!~__?[}}              
             Q0r(vcu(1{{}-?-_]!l!!l!II?                 
             OOYmw0C|){}]-1(()~ii+~;l!+                 
             QCJUCYzr){{{1(|)1~~i~lI!!~                 
             |zL0JXjrt|/||())?~i!IIl~l+?                
             ]UQCvxxt||tf(1|1-i!I;Il_li_                
            [?OZLcvrrxjt)((1}~iI:Ill_I~+                
            j(QUCYUvf|||((({[!l;;lIl+!~_?               
             tut1-__[[?][?-~i+_?11[-~l~+-               
            dQcr1?-~ii??+~]1jnOOLLUr()-~_               
            wYOcJjvt|(()/t|XLwUYUJu)v)}-+               
            wzQvmr|vxttvj)YXQLjYrxc)|][-+]              
           mmuZzrCcuxvnf}/nUOf|//cn||?}ii_              
           mw0p0Yvurux|}r}YYu-}]/Cuf(][+i-              
           wqmOYrxXv|()j1)Yr~+_]Uu1n)][-!+              
           dppmCunf//(tf[xn__-?(j}]x}][li~              
           qdqOc/(111|))//-_]]ii{)1(]?i!~i+             
           0QCYf1}}[)|t(}__+iI;!?-[~i!;!~i_             
        UYtvCCzu/1|/([~i!lIII;I!-{]~~;I!~~+             
       funUYpOzr()}-~!lIlIIlIIl!?1+ii;lii~+             
       X/jzOYncj{[[[+IlIllIllIli11~ill!l!i_             
      rt[-xUCccf[[{}_llII!lIIl!]/[~llI~iilI             
     (f}-+[rrvx||}}[-iIlIIIll!~{vz/-iIii~               
      f|[1[ fxur([-?{?ilIIlIII?((jv(-~+i                
               (1]             }?tjzt|/                 
                                                        
`;
export const HERO_ASCII = HERO_ASCII_RAW.slice(1, -1);

const HERO_LINES = HERO_ASCII.split("\n");
export const HERO_COLS = Math.max(...HERO_LINES.map((l) => l.length));
export const HERO_ROWS = HERO_LINES.length;
