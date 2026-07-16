// Generated from the alpha + luminance of the cropped cutout
// (public/hero-atlas-cut.png). A coarse 32-column grid on purpose — fewer,
// bigger characters. Padded to a full rectangle whose aspect matches the
// image, so filling the reveal frame maps it onto the same box as the photo:
// same size, same position, just rendered in large glyphs.
export const HERO_ASPECT = 0.4817;
export const HERO_ORB_X = 49.68;
export const HERO_ORB_Y = 23.93;
export const HERO_ORB_W = 90.51;
export const HERO_RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const HERO_ASCII_RAW = `
              !!i!l             
         ++++~~ii!lI;;II        
      1}]?-__~ii!I;;::::;I      
    (xzzr1]_+~!!I;:::,,:::;l    
   [1|jvUXt[_~lI;::,::::,:::;   
  +-]]]]}fc)I_|rxj1l:::,:,,,:;  
  iiiii~+_liUmwqwwmZ(,,,,,,,,,I 
 !I;;;;;;;:cwwmOzmmmZ~,,,,,,,,: 
 l;;;:::::,fwwwmmwmZL;::,:,,,,; 
  !!;:::::::)Jmmmm0xi!iII::::;! 
  xr{::::,:,,,I++!::~|j{+iI!-]  
   nc+,::::,,,,,,,::Ii?tx)?{|1  
   Zx_::,::,,,,,,,,::;l~]/||]   
   Ot{ I;:::,,:i_+!I::;Ii}U(    
  Zv1}(   ;::i[1}_!ll;   mc{    
   111))1//1tn(|t}+i_nUxru11    
     1()[?({]/|{{)_!~[}{1{      
        u[)){}_~il~ii+[{        
        CL0x1}?11+i~I!          
        UCzx|(((1+ill!_         
       ]QUnff/()[!;Ii!+         
       |Uvxj((({+I;li!+         
       Cv)_~+_~]/XJY|[_-        
       LJzrrtj/X0zcut{--        
      qCZvcxx)/Yn1)c/]_+        
      qq0vvf(ttr+_x|j]-~        
      pqLt()((/-?+{}1?i~        
     XcCv(1({-i!II+[~l!~_       
    unCJu)}_lIlIIl-?iIli+       
   j)?zXn}{-lIllli(}!li!!       
   t{]|xr|]]+lIIl_/x{++         
                   fv)          
`;
export const HERO_ASCII = HERO_ASCII_RAW.slice(1, -1);

const HERO_LINES = HERO_ASCII.split("\n");
export const HERO_COLS = Math.max(...HERO_LINES.map((l) => l.length));
export const HERO_ROWS = HERO_LINES.length;
