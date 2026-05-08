import { LinkItem } from './Common';

export default function RightPanel({ rightPanelContent, links = [] }) {
  return (
    <aside className="w-80 bg-white dark:bg-black border border-sjsu-gold p-7 hidden xl:block shrink-0 transition-all duration-300 rounded-2xl m-4">
       {rightPanelContent === 'empty' ? (
           <div className="h-full flex flex-col justify-center text-text-secondary text-xl font-medium leading-tight">
               <p className="mb-1 text-text-secondary/80">Generated Links of</p>
               <p className="text-sjsu-gold font-bold">Websites <span className="text-text-secondary font-medium">and</span> Documents</p>
               <p className="text-text-secondary/80">will appear here</p>
           </div>
       ) : (
          <div className="animate-in fade-in slide-in-from-right duration-500">
               <h2 className="text-base text-text-primary mb-6 leading-relaxed">
                  Links to <span className="font-bold text-sjsu-gold">Document</span> and <span className="font-bold text-sjsu-gold">Website</span> for this Response
               </h2>
               
               <div className="space-y-0 rounded-lg overflow-hidden border border-border-color bg-bg-main">
                   {links.map((link, index) => (
                     <LinkItem
                       key={`${link.url}-${index}`}
                       label={link.title || link.url}
                       href={link.url}
                       isFirst={index === 0}
                     />
                   ))}
               </div>
          </div>
       )}
    </aside>
  );
}
